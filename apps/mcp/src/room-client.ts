import WebSocket from "ws";
import {
  serverFrameSchema,
  type DecisionView,
  type MessageView,
} from "@clauderooms/shared";

// Only the discriminant + payload matter here; typing it this loosely sidesteps
// the zod-inferred `sequence?: number | undefined` vs the hand-written envelope
// interface under exactOptionalPropertyTypes.
type RoomEvent = { type: string; payload?: unknown };

// The engine side of the ClaudeRooms MCP server (Milestone 8). It joins a room
// as an ordinary participant over the same WebSocket protocol the web client
// uses — authenticating with a room session token — and tracks the room's
// decisions and messages, and can post a message. Kept apart from the MCP glue
// so it can be tested against a real engine with no MCP client in the loop.

export class RoomClient {
  private socket: WebSocket | null = null;
  private readonly decisions = new Map<string, DecisionView>();
  private readonly messages: MessageView[] = [];
  private roomName = "";
  private readonly ready: Promise<void>;
  private resolveReady: () => void = () => {};
  private rejectReady: (error: Error) => void = () => {};
  private settled = false;

  private constructor() {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  /** Connects and resolves once authenticated (the room snapshot has arrived). */
  static async connect(options: {
    /** ws:// or wss:// base URL of the engine (no /ws suffix). */
    wsUrl: string;
    token: string;
    timeoutMs?: number;
  }): Promise<RoomClient> {
    const client = new RoomClient();
    const socket = new WebSocket(`${options.wsUrl.replace(/\/+$/, "")}/ws`);
    client.socket = socket;

    socket.on("open", () =>
      socket.send(
        JSON.stringify({ type: "auth", protocolVersion: 1, token: options.token }),
      ),
    );
    socket.on("message", (raw) => client.onFrame(String(raw)));
    socket.on("error", (error) =>
      client.fail(error instanceof Error ? error : new Error("socket error")),
    );
    socket.on("close", () =>
      client.fail(new Error("connection closed before authentication")),
    );

    const timer = setTimeout(
      () => client.fail(new Error("timed out waiting for authentication")),
      options.timeoutMs ?? 8000,
    );
    try {
      await client.ready;
    } finally {
      clearTimeout(timer);
    }
    return client;
  }

  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectReady(error);
  }

  private onFrame(data: string): void {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = serverFrameSchema.safeParse(json);
    if (!parsed.success) return;
    const frame = parsed.data;

    if (frame.type === "error") {
      this.fail(new Error(`${frame.code}: ${frame.message}`));
      return;
    }
    if (frame.type === "auth.ok") {
      this.roomName = frame.room.name;
      for (const decision of frame.decisions) this.decisions.set(decision.id, decision);
      for (const envelope of frame.events) this.applyEvent(envelope);
      if (!this.settled) {
        this.settled = true;
        this.resolveReady();
      }
      return;
    }
    if (frame.type === "event") this.applyEvent(frame.event);
  }

  private applyEvent(envelope: RoomEvent): void {
    switch (envelope.type) {
      case "decision.proposed":
      case "decision.accepted":
      case "decision.rejected": {
        const { decision } = envelope.payload as { decision: DecisionView };
        this.decisions.set(decision.id, decision);
        break;
      }
      case "message.created":
      case "claude.completed": {
        const { message } = envelope.payload as { message: MessageView };
        if (!this.messages.some((existing) => existing.id === message.id)) {
          this.messages.push(message);
        }
        break;
      }
    }
  }

  get name(): string {
    return this.roomName;
  }

  listDecisions(): DecisionView[] {
    return [...this.decisions.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  listMessages(limit = 50): MessageView[] {
    return this.messages.slice(-Math.max(1, limit));
  }

  postMessage(content: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("not connected to the room");
    }
    this.socket.send(JSON.stringify({ type: "chat.send", content }));
  }

  close(): void {
    this.settled = true;
    this.socket?.close();
  }
}
