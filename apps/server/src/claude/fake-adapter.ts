import type { ClaudeAdapter, ClaudeAdapterEvent, ClaudeRequestInput } from "./adapter.js";

// Deterministic stand-in for the real Agent SDK adapter (Milestone 3).
// No network, no credentials, streamed in chunks so the UI's streaming path
// is exercised for real.

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export class FakeClaudeAdapter implements ClaudeAdapter {
  private cancelled = new Set<string>();

  constructor(private readonly chunkDelayMs: number = 120) {}

  async *submitRequest(input: ClaudeRequestInput): AsyncIterable<ClaudeAdapterEvent> {
    yield { type: "started" };
    const text = this.composeResponse(input);
    const chunks = text.match(/.{1,40}/gs) ?? [text];
    let assembled = "";
    for (const chunk of chunks) {
      await sleep(this.chunkDelayMs);
      if (this.cancelled.has(input.requestId)) {
        this.cancelled.delete(input.requestId);
        yield { type: "failed", failureCode: "REQUEST_CANCELLED", message: "Cancelled" };
        return;
      }
      assembled += chunk;
      yield { type: "delta", text: chunk };
    }
    yield { type: "completed", text: assembled };
  }

  private composeResponse(input: ClaudeRequestInput): string {
    return [
      `[fake Claude — no real model was called]`,
      ``,
      `You asked (mode: ${input.mode}):`,
      `> ${input.content.slice(0, 500)}`,
      ``,
      `This deterministic response proves the collaboration loop end to end: `,
      `explicit invocation, streaming, persistence, and the shared timeline. `,
      `The real Claude integration arrives in Milestone 3 via the Claude Agent SDK.`,
    ].join("\n");
  }

  async cancelRequest(requestId: string): Promise<void> {
    this.cancelled.add(requestId);
  }

  async close(): Promise<void> {
    this.cancelled.clear();
  }
}
