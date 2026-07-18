import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { buildServer, type BuiltServer } from "../src/server.js";
import { FakeClaudeAdapter } from "../src/claude/fake-adapter.js";

// The packaged-desktop serving path (Milestone 6, ADR-0009): the engine serves
// the built web client from `staticDir` on a loopback origin, with an SPA
// fallback that never masks the API. Proven here without an actual `apps/web`
// build, so the contract the packaged app relies on is a permanent regression
// test rather than a one-off manual check.

let staticDir: string;
let server: BuiltServer;
let origin: string;

beforeAll(async () => {
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "clauderooms-static-"));
  fs.writeFileSync(
    path.join(staticDir, "index.html"),
    "<!doctype html><title>shell</title>",
  );
  fs.mkdirSync(path.join(staticDir, "assets"));
  fs.writeFileSync(path.join(staticDir, "assets", "app.js"), "export const ok = 1;");

  server = await buildServer({
    config: { port: 0, dbPath: ":memory:", allowedOrigins: [] },
    adapter: new FakeClaudeAdapter(0),
    staticDir,
  });
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = server.app.server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.app.close();
  fs.rmSync(staticDir, { recursive: true, force: true });
});

describe("packaged serving path", () => {
  it("serves index.html at the root", async () => {
    const res = await fetch(`${origin}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>shell</title>");
  });

  it("serves static assets", async () => {
    const res = await fetch(`${origin}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("export const ok");
  });

  it("falls back to the SPA shell for client routes", async () => {
    const res = await fetch(`${origin}/room/anything`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>shell</title>");
  });

  it("does NOT serve the SPA shell for unknown API routes (JSON 404)", async () => {
    const res = await fetch(`${origin}/api/does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBeDefined();
  });
});
