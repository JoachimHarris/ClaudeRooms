# Collaboration protocol v1

Defined and validated in `packages/shared/src/protocol.ts` (zod). Every
payload crossing a trust boundary is parsed at runtime; unknown or invalid
frames are rejected with a typed error and never processed.

## Transport

- HTTP (REST) for room creation and joining (these mint credentials).
- WebSocket for everything real-time. The client authenticates with its
  session token in the **first frame** (never in the URL), within 5 seconds,
  or the socket is closed.

## HTTP endpoints

| method | path                      | body                           | returns                                                               |
| ------ | ------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| POST   | `/api/rooms`              | `{ roomName, displayName }`    | room, host participant, session token (once), invitation token (once) |
| POST   | `/api/rooms/:roomId/join` | `{ inviteToken, displayName }` | room, participant, session token (once)                               |
| GET    | `/api/health`             |                                | `{ ok: true }`                                                        |

Invitation links are `{webOrigin}/join/{roomId}#{inviteToken}` — the fragment
never reaches server logs.

## Client → server frames

`auth`, `chat.send`, `claude.request` (mode `discussion_only`),
`decision.propose`, `decision.resolve`, `room.end`, `ping`.

All frames carry `type` + payload; sizes are capped (16 KiB per frame,
8000 chars per message content).

## Server → client frames

- `auth.ok` — snapshot: room, participants (with presence), decisions, and
  all persisted events after the client's `sinceSequence`.
- `event` — a `ProtocolEnvelope`:

```ts
{
  protocolVersion: 1,
  eventId: string,
  roomId: string,
  sequence: number,        // per-room; omitted only for ephemeral deltas
  type: RoomEventType,
  payload: ...,            // type-specific, zod-validated
  actor: { type: "human" | "claude" | "system", id?: string },
  occurredAt: string
}
```

- `error` — `{ code, message }` with stable codes:
  `ROOM_NOT_FOUND`, `ROOM_ENDED`, `INVITATION_EXPIRED`, `INVITATION_REVOKED`,
  `INVITATION_EXHAUSTED`, `NOT_AUTHORIZED`, `INVALID_PAYLOAD`,
  `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INVALID_TRANSITION`,
  `REQUEST_TIMEOUT`, `CLAUDE_UNAVAILABLE`, `PROTOCOL_VERSION_UNSUPPORTED`.

## Event types (v1, implemented)

```
participant.joined      participant.left        participant.presence_changed
message.created         claude.requested        claude.started
claude.delta*           claude.completed        claude.failed
decision.proposed       decision.accepted       decision.rejected
room.ended
```

`*` ephemeral — broadcast live, not persisted, not sequenced. Reserved for
later milestones (names fixed now so clients can be forward-compatible):
`action.proposed/approved/rejected/started/completed/failed`,
`bridge.connected/disconnected`, `repository.status_changed`,
`decision.superseded`.

## Ordering, idempotency, reconnect

- The server assigns `sequence` inside the SQLite write transaction; clients
  render strictly by sequence.
- On reconnect the client sends `auth` with `sinceSequence`; the server
  replays everything newer. Clients de-duplicate by `eventId`.
- Version mismatch: a client sending `protocolVersion !== 1` gets
  `PROTOCOL_VERSION_UNSUPPORTED` and should prompt for an upgrade.
