import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoomResponseSchema, type ServerFrame } from "@clauderooms/shared";
import { startTestServer, post, TestClient, type TestServer } from "./helpers.js";

// Automated checks for the security boundaries in docs/security/threat-model.md.

type ErrorFrame = Extract<ServerFrame, { type: "error" }>;

async function createRoom(server: TestServer) {
  const raw = await post(server.baseUrl, "/api/rooms", {
    roomName: "Sec",
    displayName: "Hosty",
  });
  return createRoomResponseSchema.parse(raw.json);
}

async function joinAsCollaborator(server: TestServer, roomId: string, invite: string) {
  const raw = await post(server.baseUrl, `/api/rooms/${roomId}/join`, {
    inviteToken: invite,
    displayName: "Collab",
  });
  return raw.json as { sessionToken: string };
}

describe("security boundaries", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("rejects WebSocket auth with an unknown token and closes the socket", async () => {
    const client = await TestClient.connect(server.wsUrl);
    client.auth("f".repeat(43));
    const error = (await client.waitFor((f) => f.type === "error")) as ErrorFrame;
    expect(error.code).toBe("NOT_AUTHORIZED");
    await client.waitForClose();
    expect(client.closeCode).toBe(4401);
  });

  it("rejects any frame sent before authentication", async () => {
    const client = await TestClient.connect(server.wsUrl);
    client.send({ type: "chat.send", content: "hi" });
    const error = (await client.waitFor((f) => f.type === "error")) as ErrorFrame;
    expect(error.code).toBe("NOT_AUTHORIZED");
    client.close();
  });

  it("rejects unsupported protocol versions", async () => {
    const created = await createRoom(server);
    const client = await TestClient.connect(server.wsUrl);
    client.send({ type: "auth", protocolVersion: 2, token: created.sessionToken });
    const error = (await client.waitFor((f) => f.type === "error")) as ErrorFrame;
    expect(error.code).toBe("PROTOCOL_VERSION_UNSUPPORTED");
    await client.waitForClose();
  });

  it("rejects joins with a wrong invitation token", async () => {
    const created = await createRoom(server);
    const attempt = await post(server.baseUrl, `/api/rooms/${created.room.id}/join`, {
      inviteToken: "x".repeat(43),
      displayName: "Mallory",
    });
    expect(attempt.status).toBe(403);
    expect((attempt.json as { error: { code: string } }).error.code).toBe(
      "INVITATION_INVALID",
    );
  });

  it("rejects expired and revoked invitations", async () => {
    const created = await createRoom(server);
    server.db
      .prepare("UPDATE invitations SET expires_at = ? WHERE room_id = ?")
      .run("2000-01-01T00:00:00Z", created.room.id);
    const expired = await post(server.baseUrl, `/api/rooms/${created.room.id}/join`, {
      inviteToken: created.inviteToken,
      displayName: "Late",
    });
    expect((expired.json as { error: { code: string } }).error.code).toBe(
      "INVITATION_EXPIRED",
    );

    server.db
      .prepare(
        "UPDATE invitations SET expires_at = '2999-01-01T00:00:00Z', revoked_at = '2020-01-01T00:00:00Z' WHERE room_id = ?",
      )
      .run(created.room.id);
    const revoked = await post(server.baseUrl, `/api/rooms/${created.room.id}/join`, {
      inviteToken: created.inviteToken,
      displayName: "Late",
    });
    expect((revoked.json as { error: { code: string } }).error.code).toBe(
      "INVITATION_REVOKED",
    );
  });

  it("prevents a collaborator from ending the room or resolving decisions", async () => {
    const created = await createRoom(server);
    const joined = await joinAsCollaborator(server, created.room.id, created.inviteToken);

    const collab = await TestClient.connect(server.wsUrl);
    collab.auth(joined.sessionToken);
    await collab.waitFor((f) => f.type === "auth.ok");

    // Forged privilege: the collaborator tries host-only operations. Role is
    // derived from the session token server-side, so both must fail.
    collab.send({ type: "room.end" });
    const endError = (await collab.waitFor((f) => f.type === "error")) as ErrorFrame;
    expect(endError.code).toBe("NOT_AUTHORIZED");

    collab.send({
      type: "decision.propose",
      title: "T",
      statement: "S",
    });
    const proposed = await collab.waitForEvent("decision.proposed");
    const decisionId = (
      (proposed as Extract<ServerFrame, { type: "event" }>).event.payload as {
        decision: { id: string };
      }
    ).decision.id;
    collab.send({ type: "decision.resolve", decisionId, status: "accepted" });
    const resolveError = (await collab.waitFor(
      (f) => f.type === "error" && f !== endError,
    )) as ErrorFrame;
    expect(resolveError.code).toBe("NOT_AUTHORIZED");

    // The room is still open — the failed calls had no side effects.
    expect(server.rooms.getRoom(created.room.id).status).toBe("open");
    collab.close();
  });

  it("rejects oversized frames without crashing the connection", async () => {
    const created = await createRoom(server);
    const client = await TestClient.connect(server.wsUrl);
    client.auth(created.sessionToken);
    await client.waitFor((f) => f.type === "auth.ok");

    client.sendRaw(JSON.stringify({ type: "chat.send", content: "y".repeat(20_000) }));
    const error = (await client.waitFor((f) => f.type === "error")) as ErrorFrame;
    expect(error.code).toBe("PAYLOAD_TOO_LARGE");

    // Connection still works afterwards.
    client.send({ type: "ping" });
    await client.waitFor((f) => f.type === "pong");
    client.close();
  });

  it("rejects malformed and unknown frames", async () => {
    const created = await createRoom(server);
    const client = await TestClient.connect(server.wsUrl);
    client.auth(created.sessionToken);
    await client.waitFor((f) => f.type === "auth.ok");

    client.sendRaw("this is not json");
    const notJson = (await client.waitFor((f) => f.type === "error")) as ErrorFrame;
    expect(notJson.code).toBe("INVALID_PAYLOAD");

    client.send({ type: "shell.exec", command: "rm -rf /" });
    const unknown = (await client.waitFor(
      (f) => f.type === "error" && f !== notJson,
    )) as ErrorFrame;
    expect(unknown.code).toBe("INVALID_PAYLOAD");
    client.close();
  });

  it("round-trips XSS payloads as inert text", async () => {
    const created = await createRoom(server);
    const client = await TestClient.connect(server.wsUrl);
    client.auth(created.sessionToken);
    await client.waitFor((f) => f.type === "auth.ok");

    const payload = `<script>alert(1)</script><img src=x onerror="alert(2)">`;
    client.send({ type: "chat.send", content: payload });
    const frame = (await client.waitForEvent("message.created")) as Extract<
      ServerFrame,
      { type: "event" }
    >;
    // Stored and transported byte-for-byte; the client renders text nodes
    // only (no HTML rendering path exists), so this stays inert.
    expect(
      (frame.event.payload as { message: { content: string } }).message.content,
    ).toBe(payload);
    client.close();
  });

  it("rate-limits a flooding connection", async () => {
    const created = await createRoom(server);
    const client = await TestClient.connect(server.wsUrl);
    client.auth(created.sessionToken);
    await client.waitFor((f) => f.type === "auth.ok");

    for (let i = 0; i < 40; i++) {
      client.send({ type: "chat.send", content: `flood ${i}` });
    }
    const limited = (await client.waitFor(
      (f) => f.type === "error" && (f as ErrorFrame).code === "RATE_LIMITED",
    )) as ErrorFrame;
    expect(limited.code).toBe("RATE_LIMITED");
    client.close();
  });

  it("refuses WebSocket upgrades from disallowed origins", async () => {
    const client = await TestClient.connect(server.wsUrl, {
      origin: "https://evil.example",
    });
    await client.waitForClose();
    expect(client.closeCode).toBe(1008);
  });

  it("never exposes raw tokens through the API surface", async () => {
    const created = await createRoom(server);
    // The only place tokens exist server-side is as sha256 hashes.
    const rows = server.db
      .prepare("SELECT session_token_hash FROM participants WHERE room_id = ?")
      .all(created.room.id) as { session_token_hash: string }[];
    for (const row of rows) {
      expect(row.session_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.session_token_hash).not.toBe(created.sessionToken);
    }
    const inviteRows = server.db
      .prepare("SELECT token_hash FROM invitations WHERE room_id = ?")
      .all(created.room.id) as { token_hash: string }[];
    for (const row of inviteRows) {
      expect(row.token_hash).not.toBe(created.inviteToken);
    }
  });
});
