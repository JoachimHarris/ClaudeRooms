import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { BridgeServerFrame, ServerFrame } from "@clauderooms/shared";
import { bridgeServerFrameSchema, serverFrameSchema } from "@clauderooms/shared";
import { buildServer, type BuiltServer } from "../src/server.js";
import { FakeClaudeAdapter } from "../src/claude/fake-adapter.js";

export interface TestServer extends BuiltServer {
  baseUrl: string;
  wsUrl: string;
  bridgeUrl: string;
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
    bridgeUrl: `ws://127.0.0.1:${address.port}/bridge`,
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

interface BridgeWaiter {
  predicate: (frame: BridgeServerFrame) => boolean;
  resolve: (frame: BridgeServerFrame) => void;
}

/**
 * Stand-in for the Electron host bridge: connects to /bridge, authenticates,
 * and lets a test script the "Claude" responses deterministically — the same
 * delegation path the real Agent SDK bridge uses, with no paid API calls.
 */
export class TestBridge {
  readonly frames: BridgeServerFrame[] = [];
  private waiters: BridgeWaiter[] = [];
  closed = false;
  closeCode: number | null = null;

  private constructor(readonly socket: WebSocket) {}

  static async connect(bridgeUrl: string): Promise<TestBridge> {
    const socket = new WebSocket(bridgeUrl);
    const bridge = new TestBridge(socket);
    socket.on("message", (raw) => {
      const frame = bridgeServerFrameSchema.parse(JSON.parse(String(raw)));
      bridge.frames.push(frame);
      bridge.waiters = bridge.waiters.filter((waiter) => {
        if (waiter.predicate(frame)) {
          waiter.resolve(frame);
          return false;
        }
        return true;
      });
    });
    socket.on("close", (code) => {
      bridge.closed = true;
      bridge.closeCode = code;
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
      socket.once("close", () => resolve());
    });
    return bridge;
  }

  send(frame: unknown): void {
    this.socket.send(JSON.stringify(frame));
  }

  auth(token: string): void {
    this.send({ type: "bridge.auth", protocolVersion: 1, token });
  }

  waitFor(
    predicate: (frame: BridgeServerFrame) => boolean,
    timeoutMs = 4000,
  ): Promise<BridgeServerFrame> {
    const existing = this.frames.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`Timed out waiting for bridge frame after ${timeoutMs}ms`)),
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
