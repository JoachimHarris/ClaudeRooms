import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { ServerFrame } from "@clauderooms/shared";
import { serverFrameSchema } from "@clauderooms/shared";
import { buildServer, type BuiltServer } from "../src/server.js";
import { FakeClaudeAdapter } from "../src/claude/fake-adapter.js";

export interface TestServer extends BuiltServer {
  baseUrl: string;
  wsUrl: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const built = await buildServer({
    config: {
      port: 0,
      dbPath: ":memory:",
      allowedOrigins: ["http://localhost:5173"],
    },
    adapter: new FakeClaudeAdapter(0),
  });
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  const address = built.app.server.address() as AddressInfo;
  return {
    ...built,
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
    close: () => built.app.close(),
  };
}

export async function post(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

interface Waiter {
  predicate: (frame: ServerFrame) => boolean;
  resolve: (frame: ServerFrame) => void;
}

/** Thin WebSocket client that records every frame and supports waiting. */
export class TestClient {
  readonly frames: ServerFrame[] = [];
  private waiters: Waiter[] = [];
  closed = false;
  closeCode: number | null = null;

  private constructor(readonly socket: WebSocket) {}

  static async connect(
    wsUrl: string,
    headers?: Record<string, string>,
  ): Promise<TestClient> {
    const socket = new WebSocket(wsUrl, { headers: headers ?? {} });
    const client = new TestClient(socket);
    socket.on("message", (raw) => {
      const frame = serverFrameSchema.parse(JSON.parse(String(raw)));
      client.frames.push(frame);
      client.waiters = client.waiters.filter((waiter) => {
        if (waiter.predicate(frame)) {
          waiter.resolve(frame);
          return false;
        }
        return true;
      });
    });
    socket.on("close", (code) => {
      client.closed = true;
      client.closeCode = code;
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
      socket.once("close", () => resolve());
    });
    return client;
  }

  send(frame: unknown): void {
    this.socket.send(JSON.stringify(frame));
  }

  sendRaw(data: string | Buffer): void {
    this.socket.send(data);
  }

  auth(token: string, sinceSequence?: number): void {
    this.send({
      type: "auth",
      protocolVersion: 1,
      token,
      ...(sinceSequence !== undefined ? { sinceSequence } : {}),
    });
  }

  /** Resolves with the first frame (past or future) matching the predicate. */
  waitFor(
    predicate: (frame: ServerFrame) => boolean,
    timeoutMs = 4000,
  ): Promise<ServerFrame> {
    const existing = this.frames.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for frame after ${timeoutMs}ms`)),
        timeoutMs,
      );
      this.waiters.push({
        predicate,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      });
    });
  }

  waitForEvent(
    type: string,
    extra?: (frame: Extract<ServerFrame, { type: "event" }>) => boolean,
  ): Promise<ServerFrame> {
    return this.waitFor(
      (frame) =>
        frame.type === "event" &&
        frame.event.type === type &&
        (extra ? extra(frame) : true),
    );
  }

  waitForClose(timeoutMs = 4000): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for close")),
        timeoutMs,
      );
      this.socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close(): void {
    this.socket.close();
  }
}
