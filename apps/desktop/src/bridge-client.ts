import WebSocket from "ws";
import {
  bridgeServerFrameSchema,
  type BridgeClientFrame,
  type BridgeServerFrame,
  type ClaudeRequestMode,
} from "@clauderooms/shared";
import {
  runDiscussionOnly,
  runRepositoryRead,
  type ClaudeRunHandle,
} from "./claude-runner.js";

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
        this.runRequest(frame.requestId, frame.content, frame.mode);
        return;
    }
  }

  private runRequest(requestId: string, content: string, mode: ClaudeRequestMode): void {
    const finish = (frame: BridgeClientFrame) => {
      this.running.delete(requestId);
      this.send(frame);
    };

    const events = {
      onStarted: () => this.send({ type: "bridge.started", requestId }),
      onDelta: (text: string) => this.send({ type: "bridge.delta", requestId, text }),
      onCompleted: (text: string) =>
        finish({ type: "bridge.completed", requestId, text }),
      onFailed: (failureCode: string, message: string) =>
        finish({ type: "bridge.failed", requestId, failureCode, message }),
      onRepoAccess: (files: string[]) =>
        this.send({ type: "bridge.repo_access", requestId, files }),
    };

    if (mode === "repository_read") {
      const repoPath = this.options.getRepoPath();
      if (!repoPath) {
        // A room restored after a restart has no repo path (ADR-0008). Say
        // so instead of answering as if we had looked.
        finish({
          type: "bridge.failed",
          requestId,
          failureCode: "REPOSITORY_NOT_CONNECTED",
          message:
            "No repository is connected in this session — choose the folder again to let Claude read it.",
        });
        return;
      }
      this.running.set(requestId, runRepositoryRead({ content, repoPath, events }));
      return;
    }

    this.running.set(
      requestId,
      runDiscussionOnly({ content, cwd: this.options.getRepoPath(), events }),
    );
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
