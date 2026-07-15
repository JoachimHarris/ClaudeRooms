import WebSocket from "ws";
import {
  bridgeServerFrameSchema,
  type BridgeClientFrame,
  type BridgeServerFrame,
} from "@clauderooms/shared";
import { runDiscussionOnly, type ClaudeRunHandle } from "./claude-runner.js";

// The host side of the bridge: connects outbound to the engine, proves it is
// the room's host with the session token, and runs Claude locally for every
// forwarded request. The repository path and the host's credentials never
// leave this process — only request content and answer text cross the wire.

export type BridgeStatus = "connecting" | "ready" | "closed";

export class HostBridge {
  private socket: WebSocket | null = null;
  private running = new Map<string, ClaudeRunHandle>();
  private stopped = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: {
      engineUrl: string;
      token: string;
      /** Absolute repo path — read here, never sent anywhere. */
      getRepoPath: () => string | null;
      onStatus?: (status: BridgeStatus) => void;
    },
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    this.options.onStatus?.("connecting");
    const socket = new WebSocket(this.options.engineUrl);
    this.socket = socket;

    socket.on("open", () => {
      this.send({
        type: "bridge.auth",
        protocolVersion: 1,
        token: this.options.token,
      });
    });

    socket.on("message", (raw) => {
      const parsed = bridgeServerFrameSchema.safeParse(JSON.parse(String(raw)));
      if (!parsed.success) return;
      this.handle(parsed.data);
    });

    socket.on("close", () => {
      for (const handle of this.running.values()) handle.cancel();
      this.running.clear();
      if (this.stopped) return;
      this.options.onStatus?.("closed");
      this.attempts += 1;
      const delay = Math.min(1000 * 2 ** Math.min(this.attempts, 4), 10_000);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });

    socket.on("error", () => {
      /* close handler drives reconnect */
    });
  }

  private handle(frame: BridgeServerFrame): void {
    switch (frame.type) {
      case "bridge.ready":
        this.attempts = 0;
        this.options.onStatus?.("ready");
        console.log(`[clauderooms] bridge ready for room ${frame.roomId}`);
        return;
      case "bridge.error":
        console.error(`[clauderooms] bridge error: ${frame.code} ${frame.message}`);
        // Auth failures are terminal — retrying with the same token is futile.
        if (frame.code === "NOT_AUTHORIZED" || frame.code === "ROOM_ENDED") this.stop();
        return;
      case "bridge.cancel":
        this.running.get(frame.requestId)?.cancel();
        return;
      case "bridge.pong":
        return;
      case "bridge.request":
        this.runRequest(frame.requestId, frame.content);
        return;
    }
  }

  private runRequest(requestId: string, content: string): void {
    const finish = (frame: BridgeClientFrame) => {
      this.running.delete(requestId);
      this.send(frame);
    };
    const handle = runDiscussionOnly({
      content,
      cwd: this.options.getRepoPath(),
      events: {
        onStarted: () => this.send({ type: "bridge.started", requestId }),
        onDelta: (text) => this.send({ type: "bridge.delta", requestId, text }),
        onCompleted: (text) => finish({ type: "bridge.completed", requestId, text }),
        onFailed: (failureCode, message) =>
          finish({ type: "bridge.failed", requestId, failureCode, message }),
      },
    });
    this.running.set(requestId, handle);
  }

  private send(frame: BridgeClientFrame): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame));
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const handle of this.running.values()) handle.cancel();
    this.running.clear();
    this.socket?.close();
    this.options.onStatus?.("closed");
  }
}
