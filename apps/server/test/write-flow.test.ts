import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { RoomService } from "../src/rooms.js";
import { DomainError } from "../src/errors.js";

// The repository_write approval spine (Milestone 7, ADR-0011). These assert the
// milestone's acceptance directly, at the domain layer where the guarantees
// live: nothing is applied before approval, approval binds to one request,
// rejected writes never apply, and only the host can approve or report a write.

const PROPOSAL = { path: "notes.md", content: "hello\n" };

describe("repository_write flow", () => {
  let rooms: RoomService;
  let host: ReturnType<RoomService["authenticate"]>["participant"];
  let collab: ReturnType<RoomService["authenticate"]>["participant"];

  beforeEach(() => {
    rooms = new RoomService(openDatabase(":memory:"));
    const created = rooms.createRoom({ roomName: "W", displayName: "Host" });
    const joined = rooms.joinRoom({
      roomId: created.room.id,
      inviteToken: created.inviteToken,
      displayName: "Collab",
    });
    host = rooms.authenticate(created.sessionToken).participant;
    collab = rooms.authenticate(joined.sessionToken).participant;
  });

  it("parks the write awaiting approval and does not run it", () => {
    const { request, runnable } = rooms.createClaudeRequest(
      collab,
      "Propose write: notes.md",
      "repository_write",
      PROPOSAL,
    );
    expect(request.status).toBe("awaiting_approval");
    expect(request.write).toEqual(PROPOSAL);
    expect(runnable).toBe(false);
  });

  it("requires the proposal on a write, and forbids it on other modes", () => {
    expect(() => rooms.createClaudeRequest(collab, "x", "repository_write")).toThrow(
      DomainError,
    );
    expect(() =>
      rooms.createClaudeRequest(collab, "x", "repository_read", PROPOSAL),
    ).toThrow(DomainError);
  });

  it("applies only after the host approves, and only once", () => {
    const { request } = rooms.createClaudeRequest(
      collab,
      "w",
      "repository_write",
      PROPOSAL,
    );

    // Nothing may be applied while it is still parked.
    expect(() => rooms.recordWriteApplied(host, request.id, "notes.md")).toThrow(
      DomainError,
    );
    // A collaborator cannot approve.
    expect(() => rooms.approveClaudeRequest(collab, request.id)).toThrow(DomainError);

    rooms.approveClaudeRequest(host, request.id);

    // A non-host cannot report the result either.
    expect(() => rooms.recordWriteApplied(collab, request.id, "notes.md")).toThrow(
      DomainError,
    );

    const envelope = rooms.recordWriteApplied(host, request.id, "notes.md");
    expect(envelope.type).toBe("claude.write_applied");
    expect(rooms.getClaudeRequest(request.id).status).toBe("completed");

    // Bound to one: re-applying an already-applied write is an invalid transition.
    expect(() => rooms.recordWriteApplied(host, request.id, "notes.md")).toThrow(
      DomainError,
    );
  });

  it("never applies a rejected write", () => {
    const { request } = rooms.createClaudeRequest(
      collab,
      "w",
      "repository_write",
      PROPOSAL,
    );
    rooms.rejectClaudeRequest(host, request.id);
    expect(rooms.getClaudeRequest(request.id).status).toBe("rejected");
    expect(() => rooms.recordWriteApplied(host, request.id, "notes.md")).toThrow(
      DomainError,
    );
  });

  it("refuses to mark a non-write request as an applied write", () => {
    const { request } = rooms.createClaudeRequest(collab, "hi", "discussion_only");
    expect(() => rooms.recordWriteApplied(host, request.id, "x")).toThrow(DomainError);
  });

  it("records a refused write as failed, not applied", () => {
    const { request } = rooms.createClaudeRequest(
      collab,
      "w",
      "repository_write",
      PROPOSAL,
    );
    rooms.approveClaudeRequest(host, request.id);
    const envelope = rooms.recordWriteFailed(host, request.id, "'.env' is refused");
    expect(envelope.type).toBe("claude.failed");
    expect(rooms.getClaudeRequest(request.id).status).toBe("failed");
  });
});
