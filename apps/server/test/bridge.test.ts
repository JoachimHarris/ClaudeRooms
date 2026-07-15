import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoomResponseSchema,
  type BridgeServerFrame,
  type ServerFrame,
} from "@clauderooms/shared";
import {
  startTestServer,
  post,
  TestBridge,
  TestClient,
  type TestServer,
} from "./helpers.js";

// The host bridge is how real Claude runs on the host machine (Milestone 3).
// These tests drive the same delegation path with a scripted bridge instead
// of the Agent SDK, so the plumbing is proven without any paid API call.

type EventFrame = Extract<ServerFrame, { type: "event" }>;
type ErrorFrame = Extract<ServerFrame, { type: "error" }>;

async function createRoom(server: TestServer) {
  const raw = await post(server.baseUrl, "/api/rooms", {
    roomName: "Bridge",
    displayName: "Hosty",
    repositoryName: "clauderooms",
    branchName: "main",
  });
  return createRoomResponseSchema.parse(raw.json);
}

describe("host bridge", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("routes Claude requests to the host bridge instead of the fake adapter", async () => {
    const created = await createRoom(server);

    const bridge = await TestBridge.connect(server.bridgeUrl);
    bridge.auth(created.sessionToken);
    const ready = (await bridge.waitFor((f) => f.type === "bridge.ready")) as Extract<
      BridgeServerFrame,
      { type: "bridge.ready" }
    >;
    expect(ready.roomId).toBe(created.room.id);
    expect(ready.repositoryName).toBe("clauderooms");
    expect(server.hub.hasBridge(created.room.id)).toBe(true);

    const host = await TestClient.connect(server.wsUrl);
    host.auth(created.sessionToken);
    await host.waitFor((f) => f.type === "auth.ok");

    host.send({
      type: "claude.request",
      content: "Explain the data model",
      mode: "discussion_only",
    });

    // The engine forwards the request to the bridge, not to the fake adapter.
    const forwarded = (await bridge.waitFor(
      (f) => f.type === "bridge.request",
    )) as Extract<BridgeServerFrame, { type: "bridge.request" }>;
    expect(forwarded.content).toBe("Explain the data model");
    expect(forwarded.mode).toBe("discussion_only");

    // Script a streamed response the way the Agent SDK adapter would.
    bridge.send({ type: "bridge.started", requestId: forwarded.requestId });
    bridge.send({
      type: "bridge.delta",
      requestId: forwarded.requestId,
      text: "The rooms table ",
    });
    bridge.send({
      type: "bridge.delta",
      requestId: forwarded.requestId,
      text: "is the aggregate root.",
    });
    bridge.send({
      type: "bridge.completed",
      requestId: forwarded.requestId,
      text: "The rooms table is the aggregate root.",
    });

    await host.waitForEvent("claude.started");
    await host.waitForEvent("claude.delta");
    const completed = (await host.waitForEvent("claude.completed")) as EventFrame;
    const message = (completed.event.payload as { message: { content: string } }).message;
    expect(message.content).toBe("The rooms table is the aggregate root.");
    // Proof it came from the bridge and not the built-in fake adapter.
    expect(message.content).not.toContain("fake Claude");

    bridge.close();
    host.close();
  });

  it("falls back to the default adapter when no bridge is connected", async () => {
    const created = await createRoom(server);
    const host = await TestClient.connect(server.wsUrl);
    host.auth(created.sessionToken);
    await host.waitFor((f) => f.type === "auth.ok");

    host.send({ type: "claude.request", content: "Hello", mode: "discussion_only" });
    const completed = (await host.waitForEvent("claude.completed")) as EventFrame;
    const message = (completed.event.payload as { message: { content: string } }).message;
    expect(message.content).toContain("fake Claude");
    host.close();
  });

  it("fails in-flight requests when the bridge drops mid-answer", async () => {
    const created = await createRoom(server);
    const bridge = await TestBridge.connect(server.bridgeUrl);
    bridge.auth(created.sessionToken);
    await bridge.waitFor((f) => f.type === "bridge.ready");

    const host = await TestClient.connect(server.wsUrl);
    host.auth(created.sessionToken);
    await host.waitFor((f) => f.type === "auth.ok");
    host.send({ type: "claude.request", content: "Long one", mode: "discussion_only" });

    const forwarded = (await bridge.waitFor(
      (f) => f.type === "bridge.request",
    )) as Extract<BridgeServerFrame, { type: "bridge.request" }>;
    bridge.send({ type: "bridge.started", requestId: forwarded.requestId });
    await host.waitForEvent("claude.started");

    // Host quits mid-answer: the room must see an honest failure, not a hang.
    bridge.close();
    const failed = (await host.waitForEvent("claude.failed")) as EventFrame;
    const payload = failed.event.payload as { failureCode: string };
    expect(payload.failureCode).toBe("BRIDGE_OFFLINE");
    expect(server.hub.hasBridge(created.room.id)).toBe(false);
    host.close();
  });

  it("refuses a bridge opened with a collaborator token", async () => {
    const created = await createRoom(server);
    const joinRaw = await post(server.baseUrl, `/api/rooms/${created.room.id}/join`, {
      inviteToken: created.inviteToken,
      displayName: "Collab",
    });
    const collaborator = joinRaw.json as { sessionToken: string };

    const bridge = await TestBridge.connect(server.bridgeUrl);
    bridge.auth(collaborator.sessionToken);
    const error = (await bridge.waitFor((f) => f.type === "bridge.error")) as Extract<
      BridgeServerFrame,
      { type: "bridge.error" }
    >;
    expect(error.code).toBe("NOT_AUTHORIZED");
    await bridge.waitForClose();
    expect(server.hub.hasBridge(created.room.id)).toBe(false);
  });

  it("refuses a bridge opened with an unknown token", async () => {
    const bridge = await TestBridge.connect(server.bridgeUrl);
    bridge.auth("z".repeat(43));
    const error = (await bridge.waitFor((f) => f.type === "bridge.error")) as Extract<
      BridgeServerFrame,
      { type: "bridge.error" }
    >;
    expect(error.code).toBe("NOT_AUTHORIZED");
    await bridge.waitForClose();
  });

  it("ignores bridge result frames sent before authentication", async () => {
    const bridge = await TestBridge.connect(server.bridgeUrl);
    bridge.send({
      type: "bridge.completed",
      requestId: "1b671a64-40d5-491e-99b0-da01ff1f3341",
      text: "injected",
    });
    const error = (await bridge.waitFor((f) => f.type === "bridge.error")) as Extract<
      BridgeServerFrame,
      { type: "bridge.error" }
    >;
    expect(error.code).toBe("NOT_AUTHORIZED");
    bridge.close();
  });

  it("keeps ordinary chat away from the bridge", async () => {
    const created = await createRoom(server);
    const bridge = await TestBridge.connect(server.bridgeUrl);
    bridge.auth(created.sessionToken);
    await bridge.waitFor((f) => f.type === "bridge.ready");

    const host = await TestClient.connect(server.wsUrl);
    host.auth(created.sessionToken);
    await host.waitFor((f) => f.type === "auth.ok");

    host.send({ type: "chat.send", content: "just talking to my colleague" });
    await host.waitForEvent("message.created");

    // Give the engine a moment; the bridge must have received nothing.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bridge.frames.some((f) => f.type === "bridge.request")).toBe(false);

    bridge.close();
    host.close();
  });

  it("rejects an unsupported bridge protocol version", async () => {
    const created = await createRoom(server);
    const bridge = await TestBridge.connect(server.bridgeUrl);
    bridge.send({
      type: "bridge.auth",
      protocolVersion: 99,
      token: created.sessionToken,
    });
    const error = (await bridge.waitFor((f) => f.type === "bridge.error")) as Extract<
      BridgeServerFrame,
      { type: "bridge.error" }
    >;
    expect(error.code).toBe("PROTOCOL_VERSION_UNSUPPORTED");
    await bridge.waitForClose();
  });

  it("does not let a room-protocol client forge bridge frames", async () => {
    const created = await createRoom(server);
    const host = await TestClient.connect(server.wsUrl);
    host.auth(created.sessionToken);
    await host.waitFor((f) => f.type === "auth.ok");

    // Bridge frames are a separate endpoint and are not part of the room
    // protocol — the room socket must reject them outright.
    host.send({
      type: "bridge.completed",
      requestId: "1b671a64-40d5-491e-99b0-da01ff1f3341",
      text: "forged",
    });
    const error = (await host.waitFor((f) => f.type === "error")) as ErrorFrame;
    expect(error.code).toBe("INVALID_PAYLOAD");
    host.close();
  });
});
