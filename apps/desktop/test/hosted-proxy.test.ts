import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { buildServer, type BuiltServer } from "@clauderooms/server";
import { FakeClaudeAdapter } from "@clauderooms/server";
import { startHostedProxy, type HostedProxy } from "../src/hosted-proxy.js";

// The host-side proxy for a hosted room (Milestone 6, ADR-0010). We stand up a
// REAL hosted engine whose origin allow-list contains only its own origin, put
// the proxy in front, and act as the host's browser. Static comes from the
// proxy (local trusted UI); /api and /ws reach the hosted engine THROUGH the
// proxy. The WS test is the load-bearing one: it only succeeds if the proxy
// dials the hosted engine with the hosted Origin — a loopback Origin would be
// rejected — which is exactly the property ADR-0010 requires.

let hosted: BuiltServer;
let hostedOrigin: string;
let proxy: HostedProxy;
let staticDir: string;

beforeAll(async () => {
  // Tight allow-list: only the hosted origin, which we know after listen. The
  // engine reads config.allowedOrigins per request, so push into the same
  // array reference buildServer captured.
  const allowedOrigins: string[] = [];
  hosted = await buildServer({
    config: { port: 0, dbPath: ":memory:", allowedOrigins },
    adapter: new FakeClaudeAdapter(0),
  });
  await hosted.app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = hosted.app.server.address() as AddressInfo;
  hostedOrigin = `http://127.0.0.1:${port}`;
  allowedOrigins.push(hostedOrigin);

  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "clauderooms-proxy-"));
  fs.writeFileSync(
    path.join(staticDir, "index.html"),
    "<!doctype html><title>local shell</title>",
  );

  proxy = await startHostedProxy({ staticDir, engineUrl: hostedOrigin });
});

afterAll(async () => {
  await proxy.close();
  await hosted.app.close();
  fs.rmSync(staticDir, { recursive: true, force: true });
});

describe("hosted proxy", () => {
  it("serves the LOCAL trusted UI (never the hosted engine's HTML)", async () => {
    const res = await fetch(`${proxy.origin}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("local shell");
  });

  it("proxies the room HTTP API to the hosted engine", async () => {
    const res = await fetch(`${proxy.origin}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomName: "Remote", displayName: "Host" }),
    });
    // The hosted engine's status is forwarded verbatim (201 Created).
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { room?: { id?: string }; sessionToken?: string };
    expect(body.room?.id).toBeDefined();
    expect(body.sessionToken?.length).toBeGreaterThan(20);
  });

  it("proxies the room WebSocket, dialing the engine with the hosted Origin", async () => {
    // Create a room (through the proxy) to get a host token.
    const created = (await (
      await fetch(`${proxy.origin}/api/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomName: "WS room", displayName: "Host" }),
      })
    ).json()) as { sessionToken: string };

    const wsUrl = `${proxy.origin.replace(/^http/, "ws")}/ws`;
    const authOk = await new Promise<boolean>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error("no auth.ok in time")), 4000);
      socket.on("open", () =>
        socket.send(
          JSON.stringify({
            type: "auth",
            protocolVersion: 1,
            token: created.sessionToken,
          }),
        ),
      );
      socket.on("message", (raw) => {
        const frame = JSON.parse(String(raw)) as { type?: string };
        if (frame.type === "auth.ok") {
          clearTimeout(timer);
          socket.close();
          resolve(true);
        }
        if (frame.type === "error") {
          clearTimeout(timer);
          socket.close();
          reject(new Error(`server error frame: ${JSON.stringify(frame)}`));
        }
      });
      socket.on("error", reject);
    });
    expect(authOk).toBe(true);
  });
});
