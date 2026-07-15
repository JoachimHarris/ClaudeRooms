import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoomResponseSchema,
  joinRoomResponseSchema,
  type ServerFrame,
} from "@clauderooms/shared";
import { startTestServer, post, TestClient, type TestServer } from "./helpers.js";

// The critical E2E scenario from the build plan, driven through the real
// HTTP + WebSocket stack against real SQLite, with the fake Claude adapter.

type EventFrame = Extract<ServerFrame, { type: "event" }>;
type AuthOkFrame = Extract<ServerFrame, { type: "auth.ok" }>;

describe("end-to-end room flow", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("runs the full collaboration loop", async () => {
    // 1. Host creates a room over HTTP.
    const createdRaw = await post(server.baseUrl, "/api/rooms", {
      roomName: "Data model review",
      displayName: "Hosty",
    });
    expect(createdRaw.status).toBe(201);
    const created = createRoomResponseSchema.parse(createdRaw.json);
    expect(created.participant.role).toBe("host");
    expect(created.sessionToken).not.toBe(created.inviteToken);

    // 2. Host connects and authenticates.
    const host = await TestClient.connect(server.wsUrl);
    host.auth(created.sessionToken);
    const hostAuth = (await host.waitFor((f) => f.type === "auth.ok")) as AuthOkFrame;
    expect(hostAuth.room.id).toBe(created.room.id);
    expect(hostAuth.self.role).toBe("host");

    // 3. Collaborator joins via the invitation token.
    const joinedRaw = await post(server.baseUrl, `/api/rooms/${created.room.id}/join`, {
      inviteToken: created.inviteToken,
      displayName: "Collab",
    });
    expect(joinedRaw.status).toBe(200);
    const joined = joinRoomResponseSchema.parse(joinedRaw.json);
    expect(joined.participant.role).toBe("collaborator");

    // Host sees the join in real time.
    await host.waitForEvent("participant.joined", (frame) => {
      const payload = frame.event.payload as { participant: { displayName: string } };
      return payload.participant.displayName === "Collab";
    });

    // 4. Collaborator connects; both see each other with presence.
    const collab = await TestClient.connect(server.wsUrl);
    collab.auth(joined.sessionToken, 0);
    const collabAuth = (await collab.waitFor((f) => f.type === "auth.ok")) as AuthOkFrame;
    expect(collabAuth.participants.map((p) => p.displayName).sort()).toEqual([
      "Collab",
      "Hosty",
    ]);
    await host.waitFor(
      (f) =>
        f.type === "event" &&
        f.event.type === "participant.presence_changed" &&
        (f.event.payload as { participantId: string; connected: boolean })
          .participantId === joined.participant.id,
    );

    // 5. Collaborator sends an ordinary human message.
    collab.send({
      type: "chat.send",
      content: "I think the current data model is too complex for V1.",
    });
    const chatFrame = (await host.waitForEvent("message.created", (frame) => {
      const payload = frame.event.payload as { message: { content: string } };
      return payload.message.content.includes("too complex");
    })) as EventFrame;
    const chatMessage = (
      chatFrame.event.payload as {
        message: { id: string; messageType: string };
      }
    ).message;
    expect(chatMessage.messageType).toBe("human");

    // 6. Collaborator submits an explicit discussion-only Claude request.
    collab.send({
      type: "claude.request",
      content: "Review the current data model based on the concern above.",
      mode: "discussion_only",
    });
    await host.waitForEvent("claude.requested");
    await host.waitForEvent("claude.started");

    // 7. Both receive streamed deltas and a final response.
    await collab.waitForEvent("claude.delta");
    const completed = (await host.waitForEvent("claude.completed")) as EventFrame;
    const response = (
      completed.event.payload as { message: { content: string; messageType: string } }
    ).message;
    expect(response.messageType).toBe("claude_response");
    expect(response.content).toContain("[fake Claude");

    // Ordinary chat must never have reached the Claude adapter: exactly one
    // claude.requested event exists, and it belongs to the explicit request.
    const claudeRequests = host.frames.filter(
      (f): f is EventFrame => f.type === "event" && f.event.type === "claude.requested",
    );
    expect(claudeRequests.length).toBe(1);

    // 8. Reconnect restores state via sequence catch-up.
    collab.close();
    await collab.waitForClose();
    const reconnected = await TestClient.connect(server.wsUrl);
    reconnected.auth(joined.sessionToken, 0);
    const replay = (await reconnected.waitFor(
      (f) => f.type === "auth.ok",
    )) as AuthOkFrame;
    const sequences = replay.events.map((event) => event.sequence ?? 0);
    expect(sequences.length).toBeGreaterThan(4);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    const replayedTypes = replay.events.map((event) => event.type);
    expect(replayedTypes).toContain("message.created");
    expect(replayedTypes).toContain("claude.completed");
    // Ephemeral deltas are not part of durable history.
    expect(replayedTypes).not.toContain("claude.delta");

    // 9. Collaborator proposes a decision from the chat message.
    reconnected.send({
      type: "decision.propose",
      title: "Simplify the V1 data model",
      statement: "V1 supports one active repository per room.",
      rationale: "Complexity is not justified before Milestone 2.",
      sourceMessageId: chatMessage.id,
    });
    const proposed = (await host.waitForEvent("decision.proposed")) as EventFrame;
    const decision = (proposed.event.payload as { decision: { id: string } }).decision;

    // 10. Host accepts the decision; everyone sees it.
    host.send({ type: "decision.resolve", decisionId: decision.id, status: "accepted" });
    const accepted = (await reconnected.waitForEvent("decision.accepted")) as EventFrame;
    expect(
      (accepted.event.payload as { decision: { status: string } }).decision.status,
    ).toBe("accepted");

    // 11. Host ends the room; both are notified and disconnected.
    host.send({ type: "room.end" });
    await reconnected.waitForEvent("room.ended");
    await host.waitForClose();
    await reconnected.waitForClose();

    // 12. The invitation is dead after the room ends.
    const lateJoin = await post(server.baseUrl, `/api/rooms/${created.room.id}/join`, {
      inviteToken: created.inviteToken,
      displayName: "Too late",
    });
    expect(lateJoin.status).toBe(400);
  });
});
