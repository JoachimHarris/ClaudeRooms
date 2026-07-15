import { serverFrameSchema, type ServerFrame } from "@clauderooms/shared";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed";

interface RoomConnectionOptions {
  token: string;
  /** Last durable sequence already applied, for reconnect catch-up. */
  getSinceSequence: () => number;
  onFrame: (frame: ServerFrame) => void;
  onStatus: (status: ConnectionStatus) => void;
}

/** WebSocket wrapper: first-frame auth, exponential-backoff reconnect. */
export class RoomConnection {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: RoomConnectionOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    this.options.onStatus(this.attempts === 0 ? "connecting" : "reconnecting");
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    this.socket = socket;

    socket.onopen = () => {
      // Token travels in the first frame — never in the URL.
      socket.send(
        JSON.stringify({
          type: "auth",
          protocolVersion: 1,
          token: this.options.token,
          sinceSequence: this.options.getSinceSequence(),
        }),
      );
      // Keepalive so idle sockets survive proxies with read timeouts.
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 25_000);
    };

    socket.onmessage = (event) => {
      const parsed = serverFrameSchema.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success) return; // never process unvalidated frames
      if (parsed.data.type === "auth.ok") {
        this.attempts = 0;
        this.options.onStatus("connected");
      }
      this.options.onFrame(parsed.data);
    };

    socket.onclose = (event) => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (this.stopped) return;
      // 4401 = auth rejected, 1000 = deliberate close (room ended, etc.)
      if (event.code === 4401 || event.code === 1000 || event.code === 1008) {
        this.options.onStatus("closed");
        this.stopped = true;
        return;
      }
      this.attempts += 1;
      const delay = Math.min(1000 * 2 ** Math.min(this.attempts, 4), 10_000);
      this.options.onStatus("reconnecting");
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  /** Returns false if the frame could not be sent (socket not open). */
  send(frame: Record<string, unknown>): boolean {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.socket?.close();
  }
}
