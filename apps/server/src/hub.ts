import type { WebSocket } from "ws";
import type { ProtocolEnvelope, ServerFrame } from "@clauderooms/shared";
import type { RoomService } from "./rooms.js";
import type { ClaudeAdapter } from "./claude/adapter.js";

const CLAUDE_REQUEST_TIMEOUT_MS = 60_000;

interface LiveConnection {
  socket: WebSocket;
  participantId: string;
}

/**
 * Tracks live sockets per room, fans out envelopes, derives presence, and
 * orchestrates Claude requests against the adapter.
 */
export class RoomHub {
  private connections = new Map<string, Set<LiveConnection>>();

  constructor(
    private readonly rooms: RoomService,
    private readonly adapter: ClaudeAdapter,
  ) {}

  register(roomId: string, participantId: string, socket: WebSocket): void {
    let set = this.connections.get(roomId);
    if (!set) {
      set = new Set();
      this.connections.set(roomId, set);
    }
    const wasConnected = this.isConnected(roomId, participantId);
    set.add({ socket, participantId });
    if (!wasConnected) {
      this.broadcast(
        roomId,
        this.rooms.appendEvent(
          roomId,
          "participant.presence_changed",
          { participantId, connected: true },
          { type: "system" },
        ),
      );
    }
  }

  unregister(roomId: string, participantId: string, socket: WebSocket): void {
    const set = this.connections.get(roomId);
    if (!set) return;
    for (const conn of set) {
      if (conn.socket === socket) set.delete(conn);
    }
    if (set.size === 0) this.connections.delete(roomId);
    if (!this.isConnected(roomId, participantId)) {
      // Room may already be gone/ended; presence is best-effort.
      try {
        this.broadcast(
          roomId,
          this.rooms.appendEvent(
            roomId,
            "participant.presence_changed",
            { participantId, connected: false },
            { type: "system" },
          ),
        );
      } catch {
        /* ignore */
      }
    }
  }

  isConnected(roomId: string, participantId: string): boolean {
    const set = this.connections.get(roomId);
    if (!set) return false;
    for (const conn of set) {
      if (conn.participantId === participantId) return true;
    }
    return false;
  }

  broadcast(roomId: string, envelope: ProtocolEnvelope): void {
    this.send(roomId, { type: "event", event: envelope });
  }

  private send(roomId: string, frame: ServerFrame): void {
    const set = this.connections.get(roomId);
    if (!set) return;
    const data = JSON.stringify(frame);
    for (const conn of set) {
      if (conn.socket.readyState === conn.socket.OPEN) {
        conn.socket.send(data);
      }
    }
  }

  /** Closes every socket in a room (used after room.ended is broadcast). */
  closeRoom(roomId: string): void {
    const set = this.connections.get(roomId);
    if (!set) return;
    for (const conn of set) {
      conn.socket.close(1000, "room ended");
    }
    this.connections.delete(roomId);
  }

  /**
   * Drives one Claude request through the adapter, translating adapter
   * events into persisted room events + live broadcasts. Never throws.
   */
  async runClaudeRequest(input: {
    requestId: string;
    roomId: string;
    content: string;
  }): Promise<void> {
    const timeout = setTimeout(() => {
      void this.adapter.cancelRequest(input.requestId);
    }, CLAUDE_REQUEST_TIMEOUT_MS);

    let terminal = false;
    try {
      const events = this.adapter.submitRequest({
        requestId: input.requestId,
        roomId: input.roomId,
        content: input.content,
        mode: "discussion_only",
      });
      for await (const event of events) {
        switch (event.type) {
          case "started":
            this.broadcast(input.roomId, this.rooms.markClaudeStarted(input.requestId));
            break;
          case "delta":
            this.broadcast(
              input.roomId,
              this.rooms.appendEvent(
                input.roomId,
                "claude.delta",
                { requestId: input.requestId, text: event.text },
                { type: "claude" },
              ),
            );
            break;
          case "completed": {
            const { envelope } = this.rooms.completeClaudeRequest(
              input.requestId,
              event.text,
            );
            this.broadcast(input.roomId, envelope);
            terminal = true;
            break;
          }
          case "failed":
            this.broadcast(
              input.roomId,
              this.rooms.failClaudeRequest(
                input.requestId,
                event.failureCode,
                event.message,
              ),
            );
            terminal = true;
            break;
        }
      }
      if (!terminal) {
        this.broadcast(
          input.roomId,
          this.rooms.failClaudeRequest(
            input.requestId,
            "CLAUDE_UNAVAILABLE",
            "Adapter ended without a result",
          ),
        );
      }
    } catch (error) {
      try {
        this.broadcast(
          input.roomId,
          this.rooms.failClaudeRequest(
            input.requestId,
            "CLAUDE_UNAVAILABLE",
            error instanceof Error ? error.message : "Adapter error",
          ),
        );
      } catch {
        /* request may already be terminal */
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
