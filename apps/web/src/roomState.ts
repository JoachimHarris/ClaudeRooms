import type {
  ClaudeRequestView,
  DecisionView,
  MessageView,
  ParticipantView,
  ProtocolEnvelope,
  RoomView,
  ServerFrame,
} from "@clauderooms/shared";
import type { ConnectionStatus } from "./ws-client.js";

export type ClaudeStatus = "ready" | "thinking" | "responding";

export type TimelineItem =
  | { kind: "message"; message: MessageView }
  | { kind: "system"; id: string; text: string; at: string };

export interface RoomState {
  connection: ConnectionStatus | "ended";
  room: RoomView | null;
  self: ParticipantView | null;
  participants: Record<string, ParticipantView>;
  decisions: Record<string, DecisionView>;
  timeline: TimelineItem[];
  /** requestId → text streamed so far for an in-flight Claude response. */
  streaming: Record<string, string>;
  /** Requests parked until the host decides, newest last. */
  pendingApprovals: ClaudeRequestView[];
  claudeStatus: ClaudeStatus;
  lastSequence: number;
  notice: string | null;
}

export const initialRoomState: RoomState = {
  connection: "connecting",
  room: null,
  self: null,
  participants: {},
  decisions: {},
  timeline: [],
  streaming: {},
  pendingApprovals: [],
  claudeStatus: "ready",
  lastSequence: 0,
  notice: null,
};

export type RoomAction =
  | { type: "status"; status: ConnectionStatus }
  | { type: "frame"; frame: ServerFrame }
  | { type: "notice"; text: string }
  | { type: "dismissNotice" };

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case "status":
      if (state.connection === "ended") return state;
      return { ...state, connection: action.status };
    case "notice":
      return { ...state, notice: action.text };
    case "dismissNotice":
      return { ...state, notice: null };
    case "frame":
      return applyFrame(state, action.frame);
  }
}

function applyFrame(state: RoomState, frame: ServerFrame): RoomState {
  switch (frame.type) {
    case "pong":
      return state;
    case "error":
      return { ...state, notice: `${frame.code}: ${frame.message}` };
    case "auth.ok": {
      // First connect: build from scratch. Reconnect: keep the accumulated
      // timeline and merge only the events missed while offline (the server
      // replays from our lastSequence checkpoint).
      const base = state.room === null ? initialRoomState : state;
      let next: RoomState = {
        ...base,
        connection: frame.room.status === "ended" ? "ended" : "connected",
        room: frame.room,
        self: frame.self,
        streaming: {},
        pendingApprovals: [],
        claudeStatus: "ready",
        participants: Object.fromEntries(frame.participants.map((p) => [p.id, p])),
        decisions: {
          ...base.decisions,
          ...Object.fromEntries(frame.decisions.map((d) => [d.id, d])),
        },
      };
      for (const event of frame.events) {
        const envelope = event as ProtocolEnvelope;
        if (envelope.sequence !== undefined && envelope.sequence <= next.lastSequence) {
          continue;
        }
        next = applyEnvelope(next, envelope);
      }
      // Snapshot participant/decision rows are authoritative over replayed
      // join events (they carry current presence and status).
      return {
        ...next,
        participants: {
          ...next.participants,
          ...Object.fromEntries(frame.participants.map((p) => [p.id, p])),
        },
        decisions: {
          ...next.decisions,
          ...Object.fromEntries(frame.decisions.map((d) => [d.id, d])),
        },
      };
    }
    case "event": {
      const envelope = frame.event as ProtocolEnvelope;
      if (envelope.sequence !== undefined && envelope.sequence <= state.lastSequence) {
        return state; // already applied via snapshot or earlier delivery
      }
      return applyEnvelope(state, envelope);
    }
  }
}

function withSequence(state: RoomState, envelope: ProtocolEnvelope): RoomState {
  return envelope.sequence !== undefined && envelope.sequence > state.lastSequence
    ? { ...state, lastSequence: envelope.sequence }
    : state;
}

function pushSystem(state: RoomState, id: string, text: string, at: string): RoomState {
  return { ...state, timeline: [...state.timeline, { kind: "system", id, text, at }] };
}

function applyEnvelope(base: RoomState, envelope: ProtocolEnvelope): RoomState {
  const state = withSequence(base, envelope);
  switch (envelope.type) {
    case "participant.joined": {
      const { participant } = envelope.payload as { participant: ParticipantView };
      const known = state.participants[participant.id];
      return pushSystem(
        {
          ...state,
          participants: {
            ...state.participants,
            [participant.id]: known ?? participant,
          },
        },
        envelope.eventId,
        `${participant.displayName} joined the room`,
        envelope.occurredAt,
      );
    }
    case "participant.left": {
      const { participantId } = envelope.payload as { participantId: string };
      const name = state.participants[participantId]?.displayName ?? "Someone";
      return pushSystem(state, envelope.eventId, `${name} left`, envelope.occurredAt);
    }
    case "participant.presence_changed": {
      const { participantId, connected } = envelope.payload as {
        participantId: string;
        connected: boolean;
      };
      const participant = state.participants[participantId];
      if (!participant) return state;
      return {
        ...state,
        participants: {
          ...state.participants,
          [participantId]: { ...participant, connected },
        },
      };
    }
    case "message.created": {
      const { message } = envelope.payload as { message: MessageView };
      if (
        state.timeline.some(
          (item) => item.kind === "message" && item.message.id === message.id,
        )
      ) {
        return state;
      }
      return {
        ...state,
        timeline: [...state.timeline, { kind: "message", message }],
      };
    }
    case "claude.requested": {
      const { request } = envelope.payload as { request: ClaudeRequestView };
      // A parked request is not "thinking" — it is waiting for a human.
      return request.status === "awaiting_approval"
        ? state
        : { ...state, claudeStatus: "thinking" };
    }
    case "claude.approval_required": {
      const { request } = envelope.payload as { request: ClaudeRequestView };
      if (state.pendingApprovals.some((pending) => pending.id === request.id)) {
        return state;
      }
      return { ...state, pendingApprovals: [...state.pendingApprovals, request] };
    }
    case "claude.approved": {
      const { request } = envelope.payload as { request: ClaudeRequestView };
      return {
        ...state,
        claudeStatus: "thinking",
        pendingApprovals: state.pendingApprovals.filter((p) => p.id !== request.id),
      };
    }
    case "claude.rejected": {
      const { request } = envelope.payload as { request: ClaudeRequestView };
      return pushSystem(
        {
          ...state,
          pendingApprovals: state.pendingApprovals.filter((p) => p.id !== request.id),
        },
        envelope.eventId,
        "The host declined that repository request",
        envelope.occurredAt,
      );
    }
    case "claude.started": {
      const { requestId } = envelope.payload as { requestId: string };
      return {
        ...state,
        claudeStatus: "responding",
        streaming: { ...state.streaming, [requestId]: "" },
      };
    }
    case "claude.delta": {
      const { requestId, text } = envelope.payload as {
        requestId: string;
        text: string;
      };
      return {
        ...state,
        claudeStatus: "responding",
        streaming: {
          ...state.streaming,
          [requestId]: (state.streaming[requestId] ?? "") + text,
        },
      };
    }
    case "claude.completed": {
      const { requestId, message } = envelope.payload as {
        requestId: string;
        message: MessageView;
      };
      const streaming = { ...state.streaming };
      delete streaming[requestId];
      const withMessage = state.timeline.some(
        (item) => item.kind === "message" && item.message.id === message.id,
      )
        ? state.timeline
        : [...state.timeline, { kind: "message", message } as TimelineItem];
      return { ...state, streaming, claudeStatus: "ready", timeline: withMessage };
    }
    case "claude.failed": {
      const { requestId, failureCode, message } = envelope.payload as {
        requestId: string;
        failureCode: string;
        message: string;
      };
      const streaming = { ...state.streaming };
      delete streaming[requestId];
      // Show the reason, not just the code: the failure message is where we
      // explain *why* Claude could not answer, and a bare code hides it.
      return pushSystem(
        { ...state, streaming, claudeStatus: "ready" },
        envelope.eventId,
        message ? `Claude: ${message}` : `Claude request failed (${failureCode})`,
        envelope.occurredAt,
      );
    }
    case "decision.proposed":
    case "decision.accepted":
    case "decision.rejected": {
      const { decision } = envelope.payload as { decision: DecisionView };
      const verb =
        envelope.type === "decision.proposed"
          ? "proposed"
          : envelope.type === "decision.accepted"
            ? "accepted"
            : "rejected";
      return pushSystem(
        {
          ...state,
          decisions: { ...state.decisions, [decision.id]: decision },
        },
        envelope.eventId,
        `Decision ${verb}: ${decision.title}`,
        envelope.occurredAt,
      );
    }
    case "room.ended": {
      return pushSystem(
        {
          ...state,
          connection: "ended",
          room: state.room ? { ...state.room, status: "ended" } : state.room,
        },
        envelope.eventId,
        "The host ended the room",
        envelope.occurredAt,
      );
    }
    default:
      return state;
  }
}
