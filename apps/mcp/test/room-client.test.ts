import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { buildServer, type BuiltServer } from "@clauderooms/server";
import { FakeClaudeAdapter } from "@clauderooms/server";
import { RoomClient } from "../src/room-client.js";

/** Auth a raw socket and send some frames, to seed the room the client reads. */
async function seedRoom(wsUrl: string, token: string, frames: unknown[]): Promise<void> {
  const socket = new WebSocket(`${wsUrl}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  socket.send(JSON.stringify({ type: "auth", protocolVersion: 1, token }));
  await new Promise((r) => setTimeout(r, 100));
  for (const frame of frames) socket.send(JSON.stringify(frame));
  await new Promise((r) => setTimeout(r, 150));
  socket.close();
}

// The MCP server's engine client (Milestone 8), tested against a REAL engine:
// it authenticates with a room session token, reads the room's decisions from
// the snapshot + live events, and posts a message that the engine broadcasts
// back. No MCP client is involved — that layer is thin glue over this.

let engine: BuiltServer;
let baseUrl: string;
let wsUrl: string;

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  engine = await buildServer({
    config: { port: 0, dbPath: ":memory:", allowedOrigins: [] },
    adapter: new FakeClaudeAdapter(0),
  });
  await engine.app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = engine.app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  await engine.app.close();
});

describe("RoomClient", () => {
  it("authenticates and reads the room's decisions and messages", async () => {
    const created = await post("/api/rooms", { roomName: "Board", displayName: "Host" });
    const token = created.sessionToken as string;
    const roomName = (created.room as { name: string }).name;

    // Seed a message and a decision, then read them back with a fresh client
    // (which gets them from the auth.ok snapshot).
    await seedRoom(wsUrl, token, [
      { type: "chat.send", content: "Kickoff" },
      { type: "decision.propose", title: "Use pnpm", statement: "Monorepo tooling" },
    ]);

    const reader = await RoomClient.connect({ wsUrl, token });
    expect(reader.name).toBe(roomName);
    expect(reader.listMessages().some((m) => m.content === "Kickoff")).toBe(true);
    expect(reader.listDecisions().some((d) => d.title === "Use pnpm")).toBe(true);
    reader.close();
  });

  it("posts a message the engine broadcasts back", async () => {
    const created = await post("/api/rooms", { roomName: "Chat", displayName: "Host" });
    const client = await RoomClient.connect({
      wsUrl,
      token: created.sessionToken as string,
    });

    client.postMessage("Hello from MCP");
    // Wait for the engine to echo it back as message.created.
    const deadline = Date.now() + 2000;
    let seen = false;
    while (Date.now() < deadline) {
      if (client.listMessages().some((m) => m.content === "Hello from MCP")) {
        seen = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(seen).toBe(true);
    client.close();
  });

  it("rejects a bad token instead of hanging", async () => {
    await expect(
      RoomClient.connect({ wsUrl, token: "x".repeat(43), timeoutMs: 2000 }),
    ).rejects.toThrow();
  });
});
