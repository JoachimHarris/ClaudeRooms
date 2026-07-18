import { randomUUID } from "node:crypto";
import type {
  ClaudeRequestView,
  DecisionView,
  MessageView,
  ParticipantView,
  ProtocolEnvelope,
  RoomEventPayload,
  RoomEventType,
  RoomView,
} from "@clauderooms/shared";
import { EPHEMERAL_EVENT_TYPES, LIMITS, requiresApproval } from "@clauderooms/shared";
import type { AppDatabase } from "./db.js";
import { DomainError } from "./errors.js";
import { generateToken, hashToken } from "./tokens.js";

// Domain layer. All authorization decisions happen here, based on rows the
// server itself looks up — never on anything a client claims about itself.

interface RoomRow {
  id: string;
  name: string;
  status: string;
  host_participant_id: string | null;
  repository_name: string | null;
  branch_name: string | null;
  created_at: string;
  ended_at: string | null;
}

interface ParticipantRow {
  id: string;
  room_id: string;
  display_name: string;
  role: string;
  joined_at: string;
  left_at: string | null;
}

interface InvitationRow {
  id: string;
  room_id: string;
  expires_at: string;
  revoked_at: string | null;
  max_uses: number;
  used_count: number;
}

interface MessageRow {
  id: string;
  room_id: string;
  author_type: string;
  author_participant_id: string | null;
  message_type: string;
  content: string;
  request_id: string | null;
  created_at: string;
}

interface ClaudeRequestRow {
  id: string;
  room_id: string;
  created_by: string;
  content: string;
  mode: string;
  status: string;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  failure_code: string | null;
  approved_by: string | null;
  approved_at: string | null;
  write_path: string | null;
  write_content: string | null;
}

interface DecisionRow {
  id: string;
  room_id: string;
  title: string;
  statement: string;
  rationale: string | null;
  status: string;
  created_by: string;
  resolved_by: string | null;
  source_message_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface EventRow {
  room_id: string;
  sequence: number;
  event_id: string;
  type: string;
  payload_json: string;
  actor_type: string;
  actor_id: string | null;
  occurred_at: string;
}

export interface AuthenticatedParticipant {
  room: RoomView;
  participant: Omit<ParticipantView, "connected">;
}

function now(): string {
  return new Date().toISOString();
}

export class RoomService {
  constructor(private readonly db: AppDatabase) {}

  // -- mapping helpers ------------------------------------------------------

  private toRoomView(row: RoomRow): RoomView {
    return {
      id: row.id,
      name: row.name,
      status: row.status as RoomView["status"],
      repositoryName: row.repository_name,
      branchName: row.branch_name,
      createdAt: row.created_at,
      endedAt: row.ended_at,
    };
  }

  private toParticipantView(row: ParticipantRow): Omit<ParticipantView, "connected"> {
    return {
      id: row.id,
      roomId: row.room_id,
      displayName: row.display_name,
      role: row.role as ParticipantView["role"],
      joinedAt: row.joined_at,
    };
  }

  private toMessageView(row: MessageRow): MessageView {
    return {
      id: row.id,
      roomId: row.room_id,
      authorType: row.author_type as MessageView["authorType"],
      authorParticipantId: row.author_participant_id,
      messageType: row.message_type as MessageView["messageType"],
      content: row.content,
      requestId: row.request_id,
      createdAt: row.created_at,
    };
  }

  private toClaudeRequestView(row: ClaudeRequestRow): ClaudeRequestView {
    return {
      id: row.id,
      roomId: row.room_id,
      createdByParticipantId: row.created_by,
      content: row.content,
      mode: row.mode as ClaudeRequestView["mode"],
      status: row.status as ClaudeRequestView["status"],
      write:
        row.write_path !== null && row.write_content !== null
          ? { path: row.write_path, content: row.write_content }
          : null,
      requestedAt: row.requested_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      failureCode: row.failure_code,
      approvedByParticipantId: row.approved_by,
      approvedAt: row.approved_at,
    };
  }

  private toDecisionView(row: DecisionRow): DecisionView {
    return {
      id: row.id,
      roomId: row.room_id,
      title: row.title,
      statement: row.statement,
      rationale: row.rationale,
      status: row.status as DecisionView["status"],
      createdByParticipantId: row.created_by,
      resolvedByParticipantId: row.resolved_by,
      sourceMessageId: row.source_message_id,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }

  // -- events ---------------------------------------------------------------

  /**
   * Builds an envelope and, unless the event type is ephemeral, persists it
   * with the next per-room sequence number inside a transaction.
   */
  appendEvent<T extends RoomEventType>(
    roomId: string,
    type: T,
    payload: RoomEventPayload<T>,
    actor: ProtocolEnvelope["actor"],
  ): ProtocolEnvelope<T> {
    const envelope: ProtocolEnvelope<T> = {
      protocolVersion: 1,
      eventId: randomUUID(),
      roomId,
      type,
      payload,
      actor,
      occurredAt: now(),
    };
    if (EPHEMERAL_EVENT_TYPES.includes(type)) {
      return envelope;
    }
    this.db.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM room_events WHERE room_id = ?",
        )
        .get(roomId) as { next: number };
      envelope.sequence = row.next;
      this.db
        .prepare(
          `INSERT INTO room_events
             (room_id, sequence, event_id, type, payload_json, actor_type, actor_id, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          roomId,
          envelope.sequence,
          envelope.eventId,
          type,
          JSON.stringify(payload),
          actor.type,
          actor.id ?? null,
          envelope.occurredAt,
        );
    })();
    return envelope;
  }

  eventsSince(roomId: string, sinceSequence: number): ProtocolEnvelope[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM room_events WHERE room_id = ? AND sequence > ? ORDER BY sequence ASC",
      )
      .all(roomId, sinceSequence) as EventRow[];
    return rows.map((row) => ({
      protocolVersion: 1,
      eventId: row.event_id,
      roomId: row.room_id,
      sequence: row.sequence,
      type: row.type as RoomEventType,
      payload: JSON.parse(row.payload_json) as ProtocolEnvelope["payload"],
      actor: {
        type: row.actor_type as ProtocolEnvelope["actor"]["type"],
        ...(row.actor_id ? { id: row.actor_id } : {}),
      },
      occurredAt: row.occurred_at,
    }));
  }

  // -- rooms & membership ---------------------------------------------------

  createRoom(input: {
    roomName: string;
    displayName: string;
    repositoryName?: string | undefined;
    branchName?: string | undefined;
  }): {
    room: RoomView;
    participant: Omit<ParticipantView, "connected">;
    sessionToken: string;
    inviteToken: string;
    inviteExpiresAt: string;
    envelopes: ProtocolEnvelope[];
  } {
    const roomId = randomUUID();
    const participantId = randomUUID();
    const sessionToken = generateToken();
    const inviteToken = generateToken();
    const createdAt = now();
    const inviteExpiresAt = new Date(Date.now() + LIMITS.inviteTtlMs).toISOString();

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO rooms
             (id, name, status, host_participant_id, repository_name, branch_name, created_at)
           VALUES (?, ?, 'open', ?, ?, ?, ?)`,
        )
        .run(
          roomId,
          input.roomName,
          participantId,
          input.repositoryName ?? null,
          input.branchName ?? null,
          createdAt,
        );
      this.db
        .prepare(
          "INSERT INTO participants (id, room_id, display_name, role, session_token_hash, joined_at) VALUES (?, ?, ?, 'host', ?, ?)",
        )
        .run(
          participantId,
          roomId,
          input.displayName,
          hashToken(sessionToken),
          createdAt,
        );
      this.db
        .prepare(
          "INSERT INTO invitations (id, room_id, token_hash, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          roomId,
          hashToken(inviteToken),
          participantId,
          inviteExpiresAt,
          LIMITS.inviteMaxUses,
        );
    })();

    const room = this.getRoom(roomId);
    const participant = this.getParticipant(participantId);
    const joined = this.appendEvent(
      roomId,
      "participant.joined",
      { participant: { ...participant, connected: false } },
      { type: "human", id: participantId },
    );
    return {
      room,
      participant,
      sessionToken,
      inviteToken,
      inviteExpiresAt,
      envelopes: [joined],
    };
  }

  joinRoom(input: { roomId: string; inviteToken: string; displayName: string }): {
    room: RoomView;
    participant: Omit<ParticipantView, "connected">;
    sessionToken: string;
    envelopes: ProtocolEnvelope[];
  } {
    const room = this.getRoom(input.roomId);
    if (room.status !== "open") throw new DomainError("ROOM_ENDED", "Room has ended");

    const invitation = this.db
      .prepare("SELECT * FROM invitations WHERE room_id = ? AND token_hash = ?")
      .get(input.roomId, hashToken(input.inviteToken)) as InvitationRow | undefined;

    if (!invitation) {
      throw new DomainError("INVITATION_INVALID", "Invitation not recognized");
    }
    if (invitation.revoked_at) {
      throw new DomainError("INVITATION_REVOKED", "Invitation has been revoked");
    }
    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      throw new DomainError("INVITATION_EXPIRED", "Invitation has expired");
    }
    if (invitation.used_count >= invitation.max_uses) {
      throw new DomainError("INVITATION_EXHAUSTED", "Invitation has no uses left");
    }

    const participantId = randomUUID();
    const sessionToken = generateToken();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO participants (id, room_id, display_name, role, session_token_hash, joined_at) VALUES (?, ?, ?, 'collaborator', ?, ?)",
        )
        .run(
          participantId,
          input.roomId,
          input.displayName,
          hashToken(sessionToken),
          now(),
        );
      this.db
        .prepare("UPDATE invitations SET used_count = used_count + 1 WHERE id = ?")
        .run(invitation.id);
    })();

    const participant = this.getParticipant(participantId);
    const joined = this.appendEvent(
      input.roomId,
      "participant.joined",
      { participant: { ...participant, connected: false } },
      { type: "human", id: participantId },
    );
    return { room, participant, sessionToken, envelopes: [joined] };
  }

  /** Resolves a session token to a participant + room, or fails closed. */
  authenticate(sessionToken: string): AuthenticatedParticipant {
    const row = this.db
      .prepare("SELECT * FROM participants WHERE session_token_hash = ?")
      .get(hashToken(sessionToken)) as ParticipantRow | undefined;
    if (!row) throw new DomainError("NOT_AUTHORIZED", "Unknown session");
    const room = this.getRoom(row.room_id);
    return { room, participant: this.toParticipantView(row) };
  }

  getRoom(roomId: string): RoomView {
    const row = this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as
      RoomRow | undefined;
    if (!row) throw new DomainError("ROOM_NOT_FOUND", "No such room");
    return this.toRoomView(row);
  }

  getParticipant(participantId: string): Omit<ParticipantView, "connected"> {
    const row = this.db
      .prepare("SELECT * FROM participants WHERE id = ?")
      .get(participantId) as ParticipantRow | undefined;
    if (!row) throw new DomainError("NOT_AUTHORIZED", "Unknown participant");
    return this.toParticipantView(row);
  }

  listParticipants(roomId: string): Omit<ParticipantView, "connected">[] {
    const rows = this.db
      .prepare("SELECT * FROM participants WHERE room_id = ? ORDER BY joined_at ASC")
      .all(roomId) as ParticipantRow[];
    return rows.map((row) => this.toParticipantView(row));
  }

  listDecisions(roomId: string): DecisionView[] {
    const rows = this.db
      .prepare("SELECT * FROM decisions WHERE room_id = ? ORDER BY created_at ASC")
      .all(roomId) as DecisionRow[];
    return rows.map((row) => this.toDecisionView(row));
  }

  private requireOpenRoom(roomId: string): RoomView {
    const room = this.getRoom(roomId);
    if (room.status !== "open") throw new DomainError("ROOM_ENDED", "Room has ended");
    return room;
  }

  // -- messages -------------------------------------------------------------

  createHumanMessage(
    participant: Omit<ParticipantView, "connected">,
    content: string,
  ): { message: MessageView; envelope: ProtocolEnvelope } {
    this.requireOpenRoom(participant.roomId);
    const message = this.insertMessage({
      roomId: participant.roomId,
      authorType: "human",
      authorParticipantId: participant.id,
      messageType: "human",
      content,
      requestId: null,
    });
    const envelope = this.appendEvent(
      participant.roomId,
      "message.created",
      { message },
      { type: "human", id: participant.id },
    );
    return { message, envelope };
  }

  private insertMessage(input: {
    roomId: string;
    authorType: MessageView["authorType"];
    authorParticipantId: string | null;
    messageType: MessageView["messageType"];
    content: string;
    requestId: string | null;
  }): MessageView {
    const id = randomUUID();
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO messages
           (id, room_id, author_type, author_participant_id, message_type, content, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.roomId,
        input.authorType,
        input.authorParticipantId,
        input.messageType,
        input.content,
        input.requestId,
        createdAt,
      );
    return {
      id,
      roomId: input.roomId,
      authorType: input.authorType,
      authorParticipantId: input.authorParticipantId,
      messageType: input.messageType,
      content: input.content,
      requestId: input.requestId,
      createdAt,
    };
  }

  // -- Claude requests ------------------------------------------------------

  createClaudeRequest(
    participant: Omit<ParticipantView, "connected">,
    content: string,
    mode: ClaudeRequestView["mode"],
    write?: { path: string; content: string },
  ): {
    request: ClaudeRequestView;
    message: MessageView;
    envelopes: ProtocolEnvelope[];
    /** False when the request is parked awaiting host approval. */
    runnable: boolean;
  } {
    this.requireOpenRoom(participant.roomId);
    // A repository_write request must carry the proposed write, and no other
    // mode may — the proposal is the whole point of the write request, and
    // smuggling one onto a read/discussion request must not park a hidden write.
    if (mode === "repository_write" && !write) {
      throw new DomainError("INVALID_PAYLOAD", "a write request must carry a proposal");
    }
    if (mode !== "repository_write" && write) {
      throw new DomainError(
        "INVALID_PAYLOAD",
        "only a write request may carry a proposal",
      );
    }
    const requestId = randomUUID();
    const requestedAt = now();
    // Modes that can reach the host's machine start parked. `runnable` is
    // what the transport keys off — it must never infer this from the mode
    // itself, so the decision lives here with the domain rules.
    const status: ClaudeRequestView["status"] = requiresApproval(mode)
      ? "awaiting_approval"
      : "pending";
    this.db
      .prepare(
        `INSERT INTO claude_requests
           (id, room_id, created_by, content, mode, status, requested_at,
            write_path, write_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        requestId,
        participant.roomId,
        participant.id,
        content,
        mode,
        status,
        requestedAt,
        write?.path ?? null,
        write?.content ?? null,
      );

    const message = this.insertMessage({
      roomId: participant.roomId,
      authorType: "human",
      authorParticipantId: participant.id,
      messageType: "claude_request",
      content,
      requestId,
    });
    const request = this.getClaudeRequest(requestId);
    const envelopes: ProtocolEnvelope[] = [
      this.appendEvent(
        participant.roomId,
        "message.created",
        { message },
        { type: "human", id: participant.id },
      ),
      this.appendEvent(
        participant.roomId,
        "claude.requested",
        { request },
        { type: "human", id: participant.id },
      ),
    ];
    if (request.status === "awaiting_approval") {
      envelopes.push(
        this.appendEvent(
          participant.roomId,
          "claude.approval_required",
          { request },
          { type: "system" },
        ),
      );
    }
    // `runnable: false` means the caller must not hand this to an adapter.
    return { request, message, envelopes, runnable: request.status === "pending" };
  }

  /**
   * Host-only. Approves exactly one parked request and returns it ready to
   * run. Re-approving is an invalid transition, so an approval can never be
   * replayed onto a second request or a finished one.
   */
  approveClaudeRequest(
    participant: Omit<ParticipantView, "connected">,
    requestId: string,
  ): { request: ClaudeRequestView; envelope: ProtocolEnvelope } {
    // Throws unless this is the host and the request is still parked.
    this.requireApprovableRequest(participant, requestId);
    const approvedAt = now();
    this.db
      .prepare(
        "UPDATE claude_requests SET status = 'pending', approved_by = ?, approved_at = ? WHERE id = ?",
      )
      .run(participant.id, approvedAt, requestId);
    const approved = this.getClaudeRequest(requestId);
    const envelope = this.appendEvent(
      participant.roomId,
      "claude.approved",
      { request: approved, approvedByParticipantId: participant.id },
      { type: "human", id: participant.id },
    );
    return { request: approved, envelope };
  }

  /** Host-only. A rejected request is terminal and never runs. */
  rejectClaudeRequest(
    participant: Omit<ParticipantView, "connected">,
    requestId: string,
  ): { request: ClaudeRequestView; envelope: ProtocolEnvelope } {
    this.requireApprovableRequest(participant, requestId);
    this.db
      .prepare(
        "UPDATE claude_requests SET status = 'rejected', completed_at = ? WHERE id = ?",
      )
      .run(now(), requestId);
    const rejected = this.getClaudeRequest(requestId);
    const envelope = this.appendEvent(
      participant.roomId,
      "claude.rejected",
      { request: rejected, rejectedByParticipantId: participant.id },
      { type: "human", id: participant.id },
    );
    return { request: rejected, envelope };
  }

  private requireApprovableRequest(
    participant: Omit<ParticipantView, "connected">,
    requestId: string,
  ): ClaudeRequestView {
    this.requireOpenRoom(participant.roomId);
    if (participant.role !== "host") {
      throw new DomainError(
        "NOT_AUTHORIZED",
        "Only the host can approve what Claude may do",
      );
    }
    const request = this.getClaudeRequest(requestId);
    if (request.roomId !== participant.roomId) {
      throw new DomainError("NOT_AUTHORIZED", "Request belongs to another room");
    }
    if (request.status !== "awaiting_approval") {
      throw new DomainError(
        "INVALID_TRANSITION",
        `Request is not awaiting approval (status '${request.status}')`,
      );
    }
    return request;
  }

  getClaudeRequest(requestId: string): ClaudeRequestView {
    const row = this.db
      .prepare("SELECT * FROM claude_requests WHERE id = ?")
      .get(requestId) as ClaudeRequestRow | undefined;
    if (!row) throw new DomainError("INTERNAL", "Unknown Claude request");
    return this.toClaudeRequestView(row);
  }

  markClaudeStarted(requestId: string): ProtocolEnvelope {
    const request = this.getClaudeRequest(requestId);
    this.db
      .prepare(
        "UPDATE claude_requests SET status = 'running', started_at = ? WHERE id = ?",
      )
      .run(now(), requestId);
    return this.appendEvent(
      request.roomId,
      "claude.started",
      { requestId },
      { type: "claude" },
    );
  }

  /** Records the repo-relative files Claude was allowed to open (audit). */
  recordRepoAccess(requestId: string, files: string[]): ProtocolEnvelope {
    const request = this.getClaudeRequest(requestId);
    return this.appendEvent(
      request.roomId,
      "claude.repo_access",
      { requestId, files },
      { type: "claude" },
    );
  }

  /**
   * Host-only. Only an *approved* write request (mode `repository_write`,
   * status `pending`) can be marked applied or failed — so a rejected, unknown,
   * or non-write request can never be reported as a completed write (M7). The
   * physical write happens in the host's desktop; this records its outcome.
   */
  private requireApprovedWrite(
    participant: Omit<ParticipantView, "connected">,
    requestId: string,
  ): ClaudeRequestView {
    this.requireOpenRoom(participant.roomId);
    if (participant.role !== "host") {
      throw new DomainError("NOT_AUTHORIZED", "Only the host can apply a write");
    }
    const request = this.getClaudeRequest(requestId);
    if (request.roomId !== participant.roomId) {
      throw new DomainError("NOT_AUTHORIZED", "Request belongs to another room");
    }
    if (request.mode !== "repository_write") {
      throw new DomainError("INVALID_TRANSITION", "Request is not a write");
    }
    if (request.status !== "pending") {
      throw new DomainError(
        "INVALID_TRANSITION",
        `Write is not awaiting its result (status '${request.status}')`,
      );
    }
    return request;
  }

  recordWriteApplied(
    participant: Omit<ParticipantView, "connected">,
    requestId: string,
    path: string,
  ): ProtocolEnvelope {
    const request = this.requireApprovedWrite(participant, requestId);
    this.db
      .prepare(
        "UPDATE claude_requests SET status = 'completed', completed_at = ? WHERE id = ?",
      )
      .run(now(), requestId);
    return this.appendEvent(
      request.roomId,
      "claude.write_applied",
      { requestId, path },
      { type: "claude" },
    );
  }

  recordWriteFailed(
    participant: Omit<ParticipantView, "connected">,
    requestId: string,
    reason: string,
  ): ProtocolEnvelope {
    const request = this.requireApprovedWrite(participant, requestId);
    this.db
      .prepare(
        "UPDATE claude_requests SET status = 'failed', completed_at = ?, failure_code = ? WHERE id = ?",
      )
      .run(now(), "WRITE_REFUSED", requestId);
    return this.appendEvent(
      request.roomId,
      "claude.failed",
      { requestId, failureCode: "WRITE_REFUSED", message: reason },
      { type: "claude" },
    );
  }

  completeClaudeRequest(
    requestId: string,
    responseText: string,
  ): { message: MessageView; envelope: ProtocolEnvelope } {
    const request = this.getClaudeRequest(requestId);
    this.db
      .prepare(
        "UPDATE claude_requests SET status = 'completed', completed_at = ? WHERE id = ?",
      )
      .run(now(), requestId);
    const message = this.insertMessage({
      roomId: request.roomId,
      authorType: "claude",
      authorParticipantId: null,
      messageType: "claude_response",
      content: responseText,
      requestId,
    });
    const envelope = this.appendEvent(
      request.roomId,
      "claude.completed",
      { requestId, message },
      { type: "claude" },
    );
    return { message, envelope };
  }

  failClaudeRequest(
    requestId: string,
    failureCode: string,
    message: string,
  ): ProtocolEnvelope {
    const request = this.getClaudeRequest(requestId);
    this.db
      .prepare(
        "UPDATE claude_requests SET status = 'failed', completed_at = ?, failure_code = ? WHERE id = ?",
      )
      .run(now(), failureCode, requestId);
    return this.appendEvent(
      request.roomId,
      "claude.failed",
      { requestId, failureCode, message },
      { type: "claude" },
    );
  }

  // -- decisions --------------------------------------------------------------

  proposeDecision(
    participant: Omit<ParticipantView, "connected">,
    input: {
      title: string;
      statement: string;
      rationale?: string;
      sourceMessageId?: string;
    },
  ): { decision: DecisionView; envelope: ProtocolEnvelope } {
    this.requireOpenRoom(participant.roomId);
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO decisions
           (id, room_id, title, statement, rationale, status, created_by, source_message_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?)`,
      )
      .run(
        id,
        participant.roomId,
        input.title,
        input.statement,
        input.rationale ?? null,
        participant.id,
        input.sourceMessageId ?? null,
        now(),
      );
    const decision = this.getDecision(id);
    const envelope = this.appendEvent(
      participant.roomId,
      "decision.proposed",
      { decision },
      { type: "human", id: participant.id },
    );
    return { decision, envelope };
  }

  /** Only the host may resolve a decision; only `proposed` may transition. */
  resolveDecision(
    participant: Omit<ParticipantView, "connected">,
    decisionId: string,
    status: "accepted" | "rejected",
  ): { decision: DecisionView; envelope: ProtocolEnvelope } {
    this.requireOpenRoom(participant.roomId);
    if (participant.role !== "host") {
      throw new DomainError("NOT_AUTHORIZED", "Only the host can resolve decisions");
    }
    const current = this.getDecision(decisionId);
    if (current.roomId !== participant.roomId) {
      throw new DomainError("NOT_AUTHORIZED", "Decision belongs to another room");
    }
    if (current.status !== "proposed") {
      throw new DomainError(
        "INVALID_TRANSITION",
        `Cannot resolve a decision in status '${current.status}'`,
      );
    }
    this.db
      .prepare(
        "UPDATE decisions SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?",
      )
      .run(status, participant.id, now(), decisionId);
    const decision = this.getDecision(decisionId);
    const envelope = this.appendEvent(
      participant.roomId,
      status === "accepted" ? "decision.accepted" : "decision.rejected",
      { decision },
      { type: "human", id: participant.id },
    );
    return { decision, envelope };
  }

  getDecision(decisionId: string): DecisionView {
    const row = this.db
      .prepare("SELECT * FROM decisions WHERE id = ?")
      .get(decisionId) as DecisionRow | undefined;
    if (!row) throw new DomainError("INVALID_PAYLOAD", "Unknown decision");
    return this.toDecisionView(row);
  }

  // -- lifecycle ---------------------------------------------------------------

  /** Only the host may end a room. Revokes all invitations. */
  endRoom(participant: Omit<ParticipantView, "connected">): ProtocolEnvelope {
    this.requireOpenRoom(participant.roomId);
    if (participant.role !== "host") {
      throw new DomainError("NOT_AUTHORIZED", "Only the host can end the room");
    }
    const endedAt = now();
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE rooms SET status = 'ended', ended_at = ? WHERE id = ?")
        .run(endedAt, participant.roomId);
      this.db
        .prepare(
          "UPDATE invitations SET revoked_at = ? WHERE room_id = ? AND revoked_at IS NULL",
        )
        .run(endedAt, participant.roomId);
    })();
    return this.appendEvent(
      participant.roomId,
      "room.ended",
      { roomId: participant.roomId, endedByParticipantId: participant.id },
      { type: "human", id: participant.id },
    );
  }
}
