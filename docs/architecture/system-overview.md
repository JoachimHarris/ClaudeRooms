# System overview

## Components

```text
┌────────────────────────────────────────────┐
│ Browser client (apps/web)                  │
│ Chat · participants · decisions · approval │
└─────────────────────┬──────────────────────┘
                      │ HTTPS / WebSocket (typed, validated protocol)
┌─────────────────────▼──────────────────────┐
│ Collaboration server (apps/server)         │
│ Rooms · invitations · events · SQLite      │
└─────────────────────┬──────────────────────┘
                      │ authenticated outbound channel (Milestone 2+)
┌─────────────────────▼──────────────────────┐
│ Local ClaudeRooms bridge (host machine)    │
│ Host authorization · redaction · repo info │
└───────────────┬────────────────────────────┘
                │
┌───────────────▼────────────────────────────┐
│ Claude adapter                             │
│ Fake adapter (M1) · Agent SDK (M3+)        │
└────────────────────────────────────────────┘
```

## Trust boundaries

1. **Browser ↔ server.** Everything from a browser is untrusted. All
   payloads are validated with zod at the boundary; roles are looked up
   server-side, never trusted from the client; messages are size-limited and
   rate-limited.
2. **Server ↔ bridge.** The server never receives repository content
   wholesale, absolute local paths, or credentials. The bridge connects
   _outbound_ and independently validates authorization — even a compromised
   server cannot execute arbitrary local commands, because the bridge only
   performs actions the host approved for a specific proposal.
3. **Bridge ↔ Claude.** Credentials live on the host (Claude Code login /
   env). Claude's tool use is gated by the bridge via the Agent SDK's
   `canUseTool` / hooks; discussion-only requests run without tools.

In Milestone 1 the server and "bridge" run in the same local process, but the
code keeps the boundary: nothing in the room/event layer may reach the
filesystem, and the Claude adapter is invoked only through the
`ClaudeAdapter` interface.

## Repository layout

```text
clauderooms/
├── apps/
│   ├── server/        Fastify + WebSocket + SQLite collaboration server
│   └── web/           Vite + React browser client
├── packages/
│   └── shared/        domain types + zod protocol (single source of truth)
├── docs/              product, architecture, security, research, decisions
└── .github/           CI, issue and PR templates
```

Deliberately smaller than the "full" proposal (no separate `cli/`,
`local-bridge/`, `claude-adapter/`, `ui/` packages yet): those boundaries
exist as modules inside `apps/server` and `packages/shared` and get promoted
to packages when a second consumer appears (ADR-0001).

## Data flow: an "Ask Claude" request

1. Participant submits `claude.request` over WS (mode: `discussion_only`).
2. Server validates payload + membership, persists a `claude_requests` row and
   a `message` of type `claude_request`, appends events, broadcasts.
3. Server hands the sanitized request to the `ClaudeAdapter`.
4. Adapter emits `started` → `delta`* → `completed`/`failed` events; the
   server broadcasts deltas live and persists the final response as a
   `claude_response` message.
5. Reconnecting clients catch up from the event log by sequence number
   (deltas are ephemeral; the persisted final response is authoritative).

## Persistence

SQLite via `better-sqlite3`, one file per server instance, schema migrations
applied at startup. An append-only `room_events` table (per-room sequence)
drives ordering, reconnect catch-up, and the audit trail; normalized tables
(`rooms`, `participants`, `invitations`, `messages`, `claude_requests`,
`decisions`) are the write model. This is _not_ event sourcing — writes go to
both in one transaction (ADR-0003).
