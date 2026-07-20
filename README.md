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

## What works today (Milestones 0–8)

**The room**

- **The host lives in a desktop app**: open ClaudeRooms.app, pick your
  repository folder with a native dialog, create a room — no terminal
  commands (ADR-0007). Rooms persist in a left rail across restarts, with
  credentials encrypted via the OS keychain and **no plaintext fallback**
  (ADR-0008)
- **Guests need only a browser**: secure, expiring, revocable invitation
  links; zero install for collaborators
- Real-time chat with presence, strict ordering, and reconnect catch-up
- Decisions as first-class objects: propose from a message, host accepts or
  rejects — and the host's app exports them to `.clauderooms/DECISIONS.md`
  in the repo, so future Claude sessions pick them up as context

**Claude, under explicit control**

- Explicit **Ask Claude** requests — ordinary chat is _never_ sent to Claude.
  Real Claude runs on the host's machine via the Claude Agent SDK, using the
  host's own Claude Code login; credentials never leave the host
- **Host-approved repository reads**: a `repository_read` request is parked
  until the host clicks Allow — then Claude reads only what the access policy
  permits (credential files like `.env` are always refused, symlink escapes
  are caught on real paths), and the room sees a collapsible work card of
  exactly which files were opened
- **Safe writes** (ADR-0011): Claude never holds a write tool. A write is a
  _proposal_ `{path, content}` the host reviews byte-for-byte and approves
  once; only then does the host's own machine apply it, re-checked against
  the write policy. Rejected proposals never touch disk — structurally
- The host's absolute repository path never leaves the app process — it is
  redacted even out of Claude's own answers (found and fixed by live testing)

**Deployment**

- **Packaged app**: `ClaudeRooms.app` runs the collaboration engine embedded
  on loopback and serves the web client itself — no dev servers (ADR-0009)
- **Remote guests**: the same engine deploys to a small hosted instance
  behind your TLS proxy; the host's app connects _outbound_ only and never
  loads the hosted engine's code into its privileged window (ADR-0010)

**Claude Desktop / Claude Code integration (additive)**

- `@clauderooms/mcp`: a stdio **MCP server** — point Claude Desktop or Claude
  Code at a room to read its decisions and messages and post updates
- **Terminal pro mode**: mirror a Claude Code terminal session's prompts into
  a room via Claude Code hooks (never breaks your terminal on failure)

## Architecture in one picture

```
ClaudeRooms.app (host) ────────┐
  repo path, credentials,      ├── Collaboration engine (typed WS protocol,
  Claude runner, and the       │   SQLite) — embedded on loopback, or hosted
  read/write policies live     │   behind your TLS proxy for remote guests
  here and only here           │
Guest browser ─────────────────┤
Claude Desktop/Code (MCP) ─────┘
```

The engine is treated as untrusted: it never sees repository contents,
absolute paths, or credentials — locally or hosted. Every privileged action
(repo read, file write) is approved per-request by the host and audited in
the room. Details:
[system overview](docs/architecture/system-overview.md) ·
[protocol](docs/architecture/protocol.md) ·
[threat model](docs/security/threat-model.md) ·
[ADRs](docs/decisions/).

## Getting started

Requirements: Node.js ≥ 20.19, pnpm 9 (`corepack enable`).

```bash
git clone https://github.com/JoachimHarris/ClaudeRooms.git clauderooms
cd clauderooms
pnpm install
pnpm dev
```

`pnpm dev` starts the engine, the web client, and **opens the ClaudeRooms
app window**. In the app: pick your repository folder, create the room, and
copy the invitation link. Open the link in any browser (or a private window)
to join as the collaborator.

Build a standalone app (macOS arm64, unsigned for now):

```bash
pnpm --filter @clauderooms/web build
pnpm --filter @clauderooms/desktop package   # → apps/desktop/release/mac-arm64/ClaudeRooms.app
pnpm rebuild -r better-sqlite3               # restore the dev/test native build afterwards
```

To host rooms for remote guests, deploy the engine behind a TLS proxy — see
[docs/deploy/hosted-engine.md](docs/deploy/hosted-engine.md). To wire a room
into Claude Desktop/Code or mirror a terminal session, see
[apps/mcp/README.md](apps/mcp/README.md).

Development commands:

```bash
pnpm dev        # engine (:3001) + web (:5173) + the desktop app window
pnpm test       # unit + integration + E2E-flow + security tests
pnpm lint
pnpm typecheck
pnpm build
```

## Privacy & data

- **Local-first.** Rooms, messages, decisions, and the event log live in a
  SQLite file on the machine running the engine (`apps/server/data/`, or the
  app's data directory when packaged). Delete the file to delete all history.
- Only the content of **explicit** Claude requests is sent to Anthropic, via
  the host's own Claude Code credentials, which never leave the host machine.
  Repository files reach Claude only after per-request host approval, gated
  by an access policy with a credential deny-list.
- The collaboration engine never stores repository contents, absolute local
  paths, or credentials. Room session tokens on the host's disk are encrypted
  via the OS keychain; invitation and session tokens on the engine are stored
  only as SHA-256 hashes.

## Security

Please **do not** file security issues publicly — see [SECURITY.md](SECURITY.md).
Read the current [threat model](docs/security/threat-model.md) before
deploying anywhere beyond localhost. Security-critical guards are unit-tested
and mutation-checked; two real gate bypasses were found by live testing and
are documented (and fixed) in the threat model.

## Roadmap

Milestones 0–8 (foundation → engine → desktop app → real Claude → persistent
rooms → repository reads → packaged app + remote guests → safe writes →
Claude Desktop/Code integration) are built, with automated checks green.
Remaining before a first release: a real hosted TLS deployment, macOS
signing/notarization, and live round-trips for the MCP/hooks integrations.
Full detail in [docs/product/build-plan.md](docs/product/build-plan.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Decisions live as ADRs in
[docs/decisions/](docs/decisions/).

## License

[Apache-2.0](LICENSE)
