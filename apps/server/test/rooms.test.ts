import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { RoomService } from "../src/rooms.js";
import { DomainError } from "../src/errors.js";

function createRoomWithCollaborator(rooms: RoomService) {
  const created = rooms.createRoom({ roomName: "Test", displayName: "Hosty" });
  const joined = rooms.joinRoom({
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    displayName: "Collab",
  });
  return { created, joined };
}

describe("RoomService", () => {
  let db: ReturnType<typeof openDatabase>;
  let rooms: RoomService;

  beforeEach(() => {
    db = openDatabase(":memory:");
    rooms = new RoomService(db);
  });

  it("authenticates only with the exact session token", () => {
    const { created } = createRoomWithCollaborator(rooms);
    const auth = rooms.authenticate(created.sessionToken);
    expect(auth.participant.role).toBe("host");
    expect(() => rooms.authenticate("a".repeat(43))).toThrowError(DomainError);
  });

  it("rejects expired, revoked, and exhausted invitations", () => {
    const created = rooms.createRoom({ roomName: "T", displayName: "H" });

    db.prepare("UPDATE invitations SET expires_at = ?").run("2000-01-01T00:00:00Z");
    expect(() =>
      rooms.joinRoom({
        roomId: created.room.id,
        inviteToken: created.inviteToken,
        displayName: "X",
      }),
    ).toThrowError(/expired/i);

    db.prepare("UPDATE invitations SET expires_at = ?").run("2999-01-01T00:00:00Z");
    db.prepare("UPDATE invitations SET revoked_at = ?").run("2020-01-01T00:00:00Z");
    expect(() =>
      rooms.joinRoom({
        roomId: created.room.id,
        inviteToken: created.inviteToken,
        displayName: "X",
      }),
    ).toThrowError(/revoked/i);

    db.prepare("UPDATE invitations SET revoked_at = NULL, used_count = max_uses").run();
    expect(() =>
      rooms.joinRoom({
        roomId: created.room.id,
        inviteToken: created.inviteToken,
        displayName: "X",
      }),
    ).toThrowError(/no uses left/i);
  });

  it("enforces decision transitions", () => {
    const { created, joined } = createRoomWithCollaborator(rooms);
    const host = rooms.authenticate(created.sessionToken).participant;
    const collab = rooms.authenticate(joined.sessionToken).participant;

    const { decision } = rooms.proposeDecision(collab, {
      title: "One repo per room",
      statement: "V1 supports one active repository per room.",
    });
    expect(decision.status).toBe("proposed");

    // Collaborator must not be able to resolve, even their own proposal.
    expect(() => rooms.resolveDecision(collab, decision.id, "accepted")).toThrowError(
      /host/i,
    );

    const { decision: accepted } = rooms.resolveDecision(host, decision.id, "accepted");
    expect(accepted.status).toBe("accepted");
    expect(accepted.resolvedByParticipantId).toBe(host.id);

    // Terminal states never transition again.
    expect(() => rooms.resolveDecision(host, decision.id, "rejected")).toThrowError(
      /Cannot resolve/i,
    );
  });

  it("lets only the host end a room, revoking invitations", () => {
    const { created, joined } = createRoomWithCollaborator(rooms);
    const host = rooms.authenticate(created.sessionToken).participant;
    const collab = rooms.authenticate(joined.sessionToken).participant;

    expect(() => rooms.endRoom(collab)).toThrowError(/host/i);

    rooms.endRoom(host);
    expect(rooms.getRoom(created.room.id).status).toBe("ended");
    expect(() => rooms.createHumanMessage(host, "hi")).toThrowError(/ended/i);
    expect(() =>
      rooms.joinRoom({
        roomId: created.room.id,
        inviteToken: created.inviteToken,
        displayName: "Late",
      }),
    ).toThrowError(/ended/i);
  });

  it("assigns strictly increasing sequences and replays from a checkpoint", () => {
    const { created } = createRoomWithCollaborator(rooms);
    const host = rooms.authenticate(created.sessionToken).participant;
    rooms.createHumanMessage(host, "one");
    rooms.createHumanMessage(host, "two");
    rooms.createHumanMessage(host, "three");

    const all = rooms.eventsSince(created.room.id, 0);
    const sequences = all.map((event) => event.sequence ?? 0);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);

    const checkpoint = sequences[sequences.length - 2] ?? 0;
    const tail = rooms.eventsSince(created.room.id, checkpoint);
    expect(tail.length).toBe(1);
  });

  it("never persists ephemeral events", () => {
    const { created } = createRoomWithCollaborator(rooms);
    const before = rooms.eventsSince(created.room.id, 0).length;
    rooms.appendEvent(
      created.room.id,
      "claude.delta",
      { requestId: created.room.id, text: "chunk" },
      { type: "claude" },
    );
    expect(rooms.eventsSince(created.room.id, 0).length).toBe(before);
  });
});
