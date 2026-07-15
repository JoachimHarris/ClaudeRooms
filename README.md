# ClaudeRooms

**Multiplayer collaboration for Claude Code.** Build software with Claude and
your team in the same room.

> ⚠️ **Status: pre-alpha.** This is an early, local-first development version.
> It is not production ready, has no TLS built in, and should only be run on
> localhost or behind a TLS proxy you control. Expect breaking changes.

ClaudeRooms is an open-source collaboration layer: a host developer starts a
room from their machine, invites a collaborator via a secure link, and both
humans discuss, explicitly ask Claude for help, review Claude's responses and
proposed actions, and capture decisions — in one shared, auditable loop
instead of copy-pasting between a terminal and a chat app.

**ClaudeRooms is not affiliated with, sponsored by, or endorsed by
Anthropic.** "Claude" and "Claude Code" are trademarks of Anthropic, PBC, used
here only to describe interoperability.

## What works today (Milestone 1)

- Create a room and get a secure, expiring, revocable invitation link
- A collaborator joins from a browser; both see presence in real time
- Real-time chat with strict ordering and reconnect catch-up
- Explicit **Ask Claude** requests — ordinary chat is never sent to Claude
- Streamed Claude responses via a deterministic **fake adapter** (the real
  Claude Agent SDK integration is Milestone 3; see the
  [build plan](docs/product/build-plan.md))
- Decisions as first-class objects: propose from a message, host accepts or
  rejects, accepted decisions persist in a panel
- Host can end the room, which revokes invitations and closes the room
- Everything persists locally in SQLite; every event is auditable

## Architecture in one picture

```
Browser ⇄ (typed, validated WebSocket protocol) ⇄ Collaboration server (SQLite)
                                                        ⇅ (Milestone 2+)
                                     Local bridge on the host ⇄ Claude adapter
```

The local bridge is the gatekeeper: remote participants and the server never
get direct access to the host's machine. Details:
[system overview](docs/architecture/system-overview.md) ·
[protocol](docs/architecture/protocol.md) ·
[threat model](docs/security/threat-model.md).

## Getting started

Requirements: Node.js ≥ 20.19, pnpm 9 (`corepack enable`).

```bash
git clone https://github.com/JoachimHarris/ClaudeRooms.git clauderooms
cd clauderooms
pnpm install
pnpm dev
```

Open http://localhost:5173, create a room, copy the invitation link, and open
it in a second browser (or a private window) to join as the collaborator.

Development commands:

```bash
pnpm dev        # server (:3001) + web (:5173) with proxy
pnpm test       # unit + integration + E2E-flow + security tests
pnpm lint
pnpm typecheck
pnpm build
```

## Privacy & data

- **Local-first.** Rooms, messages, decisions, and the event log live in a
  SQLite file on the machine running the server (`apps/server/data/`). Delete
  the file to delete all history.
- **Nothing is sent to Claude in Milestone 1** (fake adapter, no network).
  From Milestone 3, only the content of explicit Claude requests (plus
  context the host explicitly shares) is sent to Anthropic via the host's own
  Claude Code credentials, which never leave the host machine.
- The collaboration server never stores repository contents, absolute local
  paths, or credentials.
- Invitation and session tokens are stored only as SHA-256 hashes.

## Security

Please **do not** file security issues publicly — see [SECURITY.md](SECURITY.md).
Read the current [threat model](docs/security/threat-model.md) before
deploying anywhere beyond localhost.

## Roadmap

Milestones 2–6: local bridge with repository metadata → real Claude
(discussion-only) → host-authorized repository read → narrowly scoped,
host-approved write actions → a Claude Code plugin
(`/clauderooms:start`). Full detail in [docs/product/build-plan.md](docs/product/build-plan.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Decisions live as ADRs in
[docs/decisions/](docs/decisions/).

## License

[Apache-2.0](LICENSE)
