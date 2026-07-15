import type { BridgeServerFrame } from "@clauderooms/shared";
import type { ClaudeAdapter, ClaudeAdapterEvent, ClaudeRequestInput } from "./adapter.js";

// A live host bridge, seen by the hub as an ordinary ClaudeAdapter. When the
// hub submits a request, this forwards it to the host over the bridge socket
// and turns the streamed bridge.* frames back into adapter events. The engine
// therefore never learns the repo path or credentials — only request content
// and response text cross the boundary.

interface PendingRequest {
  push: (event: ClaudeAdapterEvent) => void;
  end: () => void;
}

export class BridgeConnection implements ClaudeAdapter {
  private pending = new Map<string, PendingRequest>();
  private closed = false;

  constructor(
    readonly roomId: string,
    private readonly send: (frame: BridgeServerFrame) => void,
  ) {}

  async *submitRequest(input: ClaudeRequestInput): AsyncIterable<ClaudeAdapterEvent> {
    if (this.closed) {
      yield { type: "failed", failureCode: "BRIDGE_OFFLINE", message: "Bridge closed" };
      return;
    }

    // Simple async queue: bridge frames arriving on the socket are pushed in
    // via handleEvent; this generator drains them until a terminal event.
    const buffer: ClaudeAdapterEvent[] = [];
    let resolveNext: (() => void) | null = null;
    let done = false;

    this.pending.set(input.requestId, {
      push: (event) => {
        buffer.push(event);
        resolveNext?.();
        resolveNext = null;
      },
      end: () => {
        done = true;
        resolveNext?.();
        resolveNext = null;
      },
    });

    this.send({
      type: "bridge.request",
      requestId: input.requestId,
      content: input.content,
      mode: input.mode,
    });

    try {
      for (;;) {
        while (buffer.length > 0) {
          const event = buffer.shift();
          if (event) yield event;
        }
        if (done) return;
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
    } finally {
      this.pending.delete(input.requestId);
    }
  }

  /** Called by the /bridge handler for each host→engine frame. */
  handleEvent(requestId: string, event: ClaudeAdapterEvent, terminal: boolean): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    entry.push(event);
    if (terminal) entry.end();
  }

  async cancelRequest(requestId: string): Promise<void> {
    if (!this.closed) this.send({ type: "bridge.cancel", requestId });
  }

  /** Bridge socket dropped: fail every in-flight request so nothing hangs. */
  async close(): Promise<void> {
    this.closed = true;
    for (const [requestId, entry] of this.pending) {
      entry.push({
        type: "failed",
        failureCode: "BRIDGE_OFFLINE",
        message: "Host bridge disconnected",
      });
      entry.end();
      this.pending.delete(requestId);
    }
  }
}
