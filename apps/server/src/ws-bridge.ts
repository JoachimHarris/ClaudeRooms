import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { BridgeServerFrame } from "@clauderooms/shared";
import { bridgeClientFrameSchema, LIMITS, PROTOCOL_VERSION } from "@clauderooms/shared";
import { DomainError } from "./errors.js";
import { BridgeConnection } from "./claude/bridge-adapter.js";
import type { RoomService } from "./rooms.js";
import type { RoomHub } from "./hub.js";

// The /bridge endpoint: the host machine connects here to run Claude locally.
// Only a room's host (verified by session token) may register a bridge. The
// engine forwards Claude requests to it and streams responses back — the repo
// path and credentials stay on the host and never reach this process.
export function registerBridgeWs(
  app: FastifyInstance,
  deps: { rooms: RoomService; hub: RoomHub },
): void {
  app.get("/bridge", { websocket: true }, (socket: WebSocket) => {
    const { rooms, hub } = deps;

    let bridge: BridgeConnection | null = null;
    let roomId: string | null = null;

    const send = (frame: BridgeServerFrame) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    };

    const authTimer = setTimeout(() => {
      if (!bridge) socket.close(4401, "bridge authentication timeout");
    }, LIMITS.authTimeoutMs);

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const buffer = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw);
        if (buffer.byteLength > LIMITS.maxFrameBytes) {
          send({ type: "bridge.error", code: "PAYLOAD_TOO_LARGE", message: "Too large" });
          return;
        }
        const parsed = bridgeClientFrameSchema.safeParse(
          JSON.parse(buffer.toString("utf8")),
        );
        if (!parsed.success) {
          send({ type: "bridge.error", code: "INVALID_PAYLOAD", message: "Bad frame" });
          return;
        }
        const frame = parsed.data;

        if (frame.type === "bridge.auth") {
          if (frame.protocolVersion !== PROTOCOL_VERSION) {
            send({
              type: "bridge.error",
              code: "PROTOCOL_VERSION_UNSUPPORTED",
              message: `Engine speaks protocol v${PROTOCOL_VERSION}`,
            });
            socket.close(1002, "protocol version");
            return;
          }
          const { participant, room } = rooms.authenticate(frame.token);
          // Only the host may bridge — a collaborator token is rejected.
          if (participant.role !== "host") {
            throw new DomainError("NOT_AUTHORIZED", "Only the host can open a bridge");
          }
          if (room.status !== "open") {
            throw new DomainError("ROOM_ENDED", "Room has ended");
          }
          clearTimeout(authTimer);
          roomId = room.id;
          bridge = new BridgeConnection(room.id, send);
          hub.registerBridge(room.id, bridge);
          send({
            type: "bridge.ready",
            roomId: room.id,
            repositoryName: room.repositoryName,
          });
          return;
        }

        if (!bridge) {
          send({ type: "bridge.error", code: "NOT_AUTHORIZED", message: "Authenticate" });
          return;
        }

        switch (frame.type) {
          case "bridge.ping":
            send({ type: "bridge.pong" });
            return;
          case "bridge.started":
            bridge.handleEvent(frame.requestId, { type: "started" }, false);
            return;
          case "bridge.delta":
            bridge.handleEvent(
              frame.requestId,
              { type: "delta", text: frame.text },
              false,
            );
            return;
          case "bridge.repo_access":
            // Not terminal: the answer still follows. This is the audit of
            // what Claude was allowed to open.
            bridge.handleEvent(
              frame.requestId,
              { type: "repo_access", files: frame.files },
              false,
            );
            return;
          case "bridge.completed":
            bridge.handleEvent(
              frame.requestId,
              { type: "completed", text: frame.text },
              true,
            );
            return;
          case "bridge.failed":
            bridge.handleEvent(
              frame.requestId,
              {
                type: "failed",
                failureCode: frame.failureCode,
                message: frame.message,
              },
              true,
            );
            return;
        }
      } catch (error) {
        if (error instanceof DomainError) {
          send({ type: "bridge.error", code: error.code, message: error.message });
          if (error.code === "NOT_AUTHORIZED") socket.close(4401, "unauthorized");
          return;
        }
        app.log.error({ err: error }, "unhandled bridge error");
        send({ type: "bridge.error", code: "INTERNAL", message: "Internal error" });
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (bridge && roomId) hub.unregisterBridge(roomId, bridge);
    });
  });
}
