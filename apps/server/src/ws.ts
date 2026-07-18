import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type {
  ErrorCode,
  ParticipantView,
  RoomView,
  ServerFrame,
} from "@clauderooms/shared";
import { clientFrameSchema, LIMITS, PROTOCOL_VERSION } from "@clauderooms/shared";
import { DomainError } from "./errors.js";
import { TokenBucket } from "./ratelimit.js";
import type { RoomService } from "./rooms.js";
import type { RoomHub } from "./hub.js";
import type { ServerConfig } from "./config.js";

interface AuthState {
  participant: Omit<ParticipantView, "connected">;
  room: RoomView;
}

export function registerWs(
  app: FastifyInstance,
  deps: { rooms: RoomService; hub: RoomHub; config: ServerConfig },
): void {
  app.get("/ws", { websocket: true }, (socket: WebSocket, request) => {
    const { rooms, hub, config } = deps;

    // Browsers always send Origin; reject sockets forged from other sites.
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      socket.close(1008, "origin not allowed");
      return;
    }

    let auth: AuthState | null = null;
    const bucket = new TokenBucket(20, 10);

    const send = (frame: ServerFrame) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    };
    const sendError = (code: ErrorCode, message: string) =>
      send({ type: "error", code, message });

    const authTimer = setTimeout(() => {
      if (!auth) socket.close(4401, "authentication timeout");
    }, LIMITS.authTimeoutMs);

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const buffer = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw);

        if (buffer.byteLength > LIMITS.maxFrameBytes) {
          sendError("PAYLOAD_TOO_LARGE", "Frame exceeds size limit");
          return;
        }

        let json: unknown;
        try {
          json = JSON.parse(buffer.toString("utf8"));
        } catch {
          sendError("INVALID_PAYLOAD", "Frame is not valid JSON");
          return;
        }

        const parsed = clientFrameSchema.safeParse(json);
        if (!parsed.success) {
          sendError("INVALID_PAYLOAD", "Frame failed validation");
          return;
        }
        const frame = parsed.data;

        if (!bucket.tryTake()) {
          sendError("RATE_LIMITED", "Slow down");
          return;
        }

        if (frame.type === "auth") {
          if (frame.protocolVersion !== PROTOCOL_VERSION) {
            sendError(
              "PROTOCOL_VERSION_UNSUPPORTED",
              `Server speaks protocol v${PROTOCOL_VERSION}`,
            );
            socket.close(1002, "protocol version unsupported");
            return;
          }
          const authenticated = rooms.authenticate(frame.token);
          auth = authenticated;
          clearTimeout(authTimer);
          hub.register(authenticated.room.id, authenticated.participant.id, socket);

          const participants = rooms
            .listParticipants(authenticated.room.id)
            .map((participant) => ({
              ...participant,
              connected: hub.isConnected(authenticated.room.id, participant.id),
            }));
          send({
            type: "auth.ok",
            room: authenticated.room,
            self: { ...authenticated.participant, connected: true },
            participants,
            decisions: rooms.listDecisions(authenticated.room.id),
            events: rooms.eventsSince(authenticated.room.id, frame.sinceSequence ?? 0),
          });
          return;
        }

        if (!auth) {
          sendError("NOT_AUTHORIZED", "Authenticate first");
          return;
        }
        const { participant } = auth;
        const roomId = participant.roomId;

        switch (frame.type) {
          case "ping":
            send({ type: "pong" });
            return;
          case "chat.send": {
            const { envelope } = rooms.createHumanMessage(participant, frame.content);
            hub.broadcast(roomId, envelope);
            return;
          }
          case "claude.request": {
            const {
              request: claudeRequest,
              envelopes,
              runnable,
            } = rooms.createClaudeRequest(
              participant,
              frame.content,
              frame.mode,
              frame.write,
            );
            for (const envelope of envelopes) hub.broadcast(roomId, envelope);
            // Only the domain layer decides whether this may run — never the
            // mode string here. A parked request waits for the host.
            if (runnable) {
              void hub.runClaudeRequest({
                requestId: claudeRequest.id,
                roomId,
                content: claudeRequest.content,
                mode: claudeRequest.mode,
              });
            }
            return;
          }
          case "claude.approve": {
            // Host-only and single-use; both enforced in the domain layer.
            const { request: approved, envelope } = rooms.approveClaudeRequest(
              participant,
              frame.requestId,
            );
            hub.broadcast(roomId, envelope);
            // A write is not run through the Claude adapter: the host's desktop
            // applies it on seeing `claude.approved` and reports the outcome via
            // `claude.write_result` (ADR-0011). Nothing runs here.
            if (approved.mode !== "repository_write") {
              void hub.runClaudeRequest({
                requestId: approved.id,
                roomId,
                content: approved.content,
                mode: approved.mode,
              });
            }
            return;
          }
          case "claude.reject": {
            const { envelope } = rooms.rejectClaudeRequest(participant, frame.requestId);
            hub.broadcast(roomId, envelope);
            return;
          }
          case "claude.write_result": {
            // Host-only, and only for an approved write (enforced in the domain
            // layer). This records the outcome of the write the host's desktop
            // already applied to disk.
            const envelope =
              frame.ok && frame.path
                ? rooms.recordWriteApplied(participant, frame.requestId, frame.path)
                : rooms.recordWriteFailed(
                    participant,
                    frame.requestId,
                    frame.reason ?? "the write could not be applied",
                  );
            hub.broadcast(roomId, envelope);
            return;
          }
          case "decision.propose": {
            const { envelope } = rooms.proposeDecision(participant, {
              title: frame.title,
              statement: frame.statement,
              ...(frame.rationale !== undefined ? { rationale: frame.rationale } : {}),
              ...(frame.sourceMessageId !== undefined
                ? { sourceMessageId: frame.sourceMessageId }
                : {}),
            });
            hub.broadcast(roomId, envelope);
            return;
          }
          case "decision.resolve": {
            const { envelope } = rooms.resolveDecision(
              participant,
              frame.decisionId,
              frame.status,
            );
            hub.broadcast(roomId, envelope);
            return;
          }
          case "room.end": {
            const envelope = rooms.endRoom(participant);
            hub.broadcast(roomId, envelope);
            hub.closeRoom(roomId);
            return;
          }
        }
      } catch (error) {
        if (error instanceof DomainError) {
          sendError(error.code, error.message);
          if (error.code === "NOT_AUTHORIZED" && !auth)
            socket.close(4401, "unauthorized");
          return;
        }
        app.log.error({ err: error }, "unhandled ws error");
        sendError("INTERNAL", "Internal error");
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (auth) hub.unregister(auth.room.id, auth.participant.id, socket);
    });
  });
}
