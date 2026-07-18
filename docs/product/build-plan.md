# Build plan

Small, demonstrable milestones. Each is done only when its acceptance
criteria pass (tests + lint + typecheck + build green). Reoriented
desktop-first on 2026-07-15 (ADR-0007).

## Milestone 0 — Repository foundation ✅

pnpm workspace, strict TypeScript, ESLint + Prettier, Vitest, GitHub Actions
CI, open-source files, initial docs, CLAUDE.md.

## Milestone 1 — Collaboration engine with fake Claude ✅

Rooms, hashed expiring invitations, presence, real-time chat, explicit
Ask-Claude with streamed fake response, decisions, room lifecycle, SQLite,
reconnect catch-up, rate/size limits, security test suite, full-stack E2E
flow test.

## Milestone 2 — Desktop host app ✅

The host experience moves into ClaudeRooms.app (Electron; ADR-0007):
native repository picker (name + branch only — the absolute path never
leaves the app process), room creation from the app, browser demoted to
guest-join only. Protocol validates repository metadata against path
smuggling.
**Accepted when:** `pnpm dev` opens the app; the host creates a room with
repo metadata without touching a browser or terminal command; the guest
flow still works in a plain browser; the server never sees an absolute
path; all checks green.

## Milestone 3 — Real Claude in the app ✅

Claude runs for real, on the host machine, via the Claude Agent SDK inside
the desktop app's main process — the only place that holds the repository
path and the host's Claude Code credentials. The engine delegates each
explicit request over a host **bridge** (`/bridge`, host-token only) and
streams the answer into the room; with no bridge connected it falls back to
the fake adapter, which keeps tests and browser-only usage working with no
paid API calls. Also: dark/light theming (system-following with an override).

Mode is `discussion_only`: Claude reasons and answers, but nothing from the
repository reaches it. That took four gates — see
`apps/desktop/src/claude-runner.ts`; `allowedTools: []` alone does **not**
remove tools, and omitting `settingSources` leaks `CLAUDE.md` into the
prompt (both found by testing in the app, see the threat model).

**Accepted when:** a room request produces a real streamed Claude answer
(verified in-app); asking Claude to quote a repo file is honestly declined;
ordinary chat never reaches the bridge; credentials and repo path stay on
the host; CI makes no paid calls. All met.

## Milestone 4 — Workspace shell: rooms in a persistent left rail ✅

Rooms stopped being one-shot. A left rail lists your rooms, they survive app
restarts, and you switch between them in one click; `×` forgets a room and
its credentials. No accounts: the app itself remembers `{roomId, token}` in
an encrypted store (ADR-0008) — `safeStorage`, mode 0600, and **no plaintext
fallback**: without OS encryption, rooms simply are not remembered and the
rail says so.

Reopening a remembered room re-attaches the Claude bridge; the repository
path is still never persisted, so Claude works discussion-only until the
host re-picks the folder.

**Accepted when:** a room created in the app is still in the rail after a
full restart, opens with its history, and its bridge reconnects; the store
on disk contains no readable tokens; guests are unaffected. All verified in
the app.

## Milestone 5 — Repository-aware Claude (in progress)

`repository_read` mode: host-approved, scoped file access (the gates in
Milestone 3 are lifted per request, never globally), shared summaries of what
Claude looked at, redaction of `.env*`/keys/hidden files, audit events, and
the hybrid timeline's collapsible work cards for Claude's steps.

**Step 1 ✅ — the access policy.** `apps/desktop/src/repo-access.ts` decides
what may be read: real-path resolution before containment (so symlinked files
_and_ directories cannot escape), a credential deny-list checked on both the
requested and the resolved name, and a size cap. It reads nothing itself, so
it is fully unit-testable — 18 tests, and the symlink protection is
mutation-checked (removing `realpathSync` fails exactly the four escape
tests). This also gives `apps/desktop` its first test suite.

**Step 2a ✅ — the approval flow.** `repository_read` exists end to end, but
only ever _asks_: the engine parks it as `awaiting_approval` and the
transport runs a request only when the domain layer says `runnable`, never
by inspecting the mode itself. Host-only approve/reject, bound to one
request (re-approving is `INVALID_TRANSITION`), `approved_by`/`approved_at`
audited. The approval strip sits above the composer — never in the chat log
— and quotes the request verbatim. Five security tests, mutation-checked:
ignoring the gate fails exactly those four that guard it. An approved
request currently fails honestly ("approved but not implemented yet")
rather than quietly answering without the repository.

**Step 2b ✅ — the runner reads.** An approved `repository_read` now lifts the
M3 gates _for that one request_: read-only tools (`Read`, `Glob`; `Grep`
deliberately excluded — it returns file contents, so it needs result-level
redaction, a later step), `settingSources: []` and `allowedTools: []` stay,
and `canUseTool` runs every call through `RepoAccessPolicy` before it happens.
The dispatch gate lives in `apps/desktop/src/tool-gate.ts` — SDK-free, so it
is unit-tested on its own (22 tests, mutation-checked; it fails closed, so an
unrecognised tool is denied). Files opened are recorded repo-relative and
broadcast as a durable `claude.repo_access` audit event the whole room sees. A
room restored without a repo path (ADR-0008) fails with
`REPOSITORY_NOT_CONNECTED` rather than answering as if it had looked.

_Found in testing:_ with cwd = repo root, Claude's own answer text echoed the
host's **absolute** path (`…/ClaudeRooms/package.json`) into the room —
breaking the ADR-0007 promise that the absolute path never leaves the Electron
main process. Fixed with `redactRepoRoots`: the runner strips both the
realpath'd root and the picked path out of every delta and the final answer
inside the host process before any text reaches the engine (hard guard on the
durable answer, unit + mutation tested), with the system prompt asking for
repo-relative paths as defence in depth.

_Found in live verification (more serious):_ the whole `canUseTool` gate was
never being called. With `allowedTools: []` the SDK still auto-approves
read-only tools in the default permission mode, so `RepoAccessPolicy` never
ran and a "read `.env`" would have leaked the secret — the unit tests passed
because they test `checkToolCall` directly, never the SDK's decision to call
it. Fixed by forcing every available tool onto the permission `ask` list
(`settings.permissions.ask = REPOSITORY_READ_TOOLS`). Verified against live
Claude: `canUseTool` now fires, and a real `.env` read is denied with its
contents withheld. This is the same lesson as M3 — the SDK's tool/permission
options do not mean what their names suggest, so each gate must be proven by
watching real behaviour, not by trusting the option.

**Step 2c ✅ — the work card.** The repo-access audit is no longer a flat
system line: `claude.repo_access` renders as a collapsible work card in the
timeline (`<details>`/`<summary>`, collapsed by default), summarising "Claude
read N files from the repository" and expanding to the repo-relative list.
Native disclosure, keyboard-accessible, paths rendered as text nodes only (no
raw HTML — hard rule 5). This is the first, minimal version of the hybrid
timeline's work cards; richer steps (per-tool timing, longer reads) can hang
off the same card shape later.

With that, Milestone 5's vertical slice is complete: a collaborator can ask
Claude to read the repository, the host approves once, Claude reads only what
`RepoAccessPolicy` allows, and the whole room sees both the answer and a
collapsible record of exactly which files were opened — with no absolute host
path ever leaving the desktop process.

## Milestone 6 — Packaged app + remote guests

The architecture is decided in **ADR-0009**: the engine is one component,
deployed either _embedded_ (in the packaged app's main process, loopback) or
_hosted_ (cloud, for remote guests); the desktop app is a host bridge + local
Claude runner in both cases and never accepts inbound connections.

**Step 1 ✅ — the serving contract.** The packaged app loads its UI from the
engine, not a Vite server. `buildServer({ staticDir })` serves the built web
client with an SPA fallback that never masks the API (`/api/*` still returns a
JSON 404). Locked as a regression test (`static-serving.test.ts`, 4 tests) so
the contract the packaged runtime depends on cannot silently break — proven
under system Node against a temp `staticDir`, and end-to-end against the real
`apps/web` build (index, assets, SPA route all 200).

**Step 2 ✅ — the package.** The `app.isPackaged` bail is gone. The packaged
runtime starts the embedded engine in the main process (`engine.ts`) bound to
`127.0.0.1:0`, reads the port, serves `staticDir` = the bundled web build
(`dist/web`), and loads the window from that loopback origin (pushed into
`allowedOrigins` after listen, so the same-origin WS is accepted). The
workspace packages are esbuild-bundled into `dist/main.mjs` and moved to
devDependencies; only the runtime externals (better-sqlite3, fastify, the
Agent SDK, ws) are collected from node_modules. `electron-builder --dir`
(macOS arm64) rebuilds `better-sqlite3` for Electron's ABI and assembles
`ClaudeRooms.app`. **Verified:** launched with all dev servers killed, the app
starts its embedded engine, loads the UI from the loopback origin, and creates
a room (SQLite write succeeds under Electron's ABI) — index/SPA/assets all 200.

_Known rough edge:_ `@electron/rebuild` rebuilds the **workspace** copy of
`better-sqlite3` for Electron (NODE_MODULE_VERSION 130), which then fails under
system Node (115) — so `pnpm run package` breaks dev/tests until
`pnpm rebuild -r better-sqlite3` restores the Node build. A later slice should
package from an isolated install so the two never collide. Signing +
notarization + a `.dmg` also remain (needs a Developer ID certificate).

**Step 3 (in progress) — remote guests.** ADR-0010 settles the security-critical
part: the host must reach a hosted room **without executing the engine's code
with local privileges** (the host window holds `window.clauderooms`, which can
return any remembered room's tokens). Decision: the host window only ever loads
local trusted UI; the desktop main **proxies** the room to the hosted engine,
and the bridge dials it outbound — the engine sees room data, never the repo,
credentials, or host-window code.

_Hosted engine (done + verified):_ the same `apps/server` now takes a
configurable bind (`CLAUDEROOMS_HOST`, loopback by default), an optional
`CLAUDEROOMS_STATIC_DIR`, and a public origin allow-list. Run standalone it
serves the web client and hosts rooms with invitations — exactly what a remote
guest connects to (`docs/deploy/hosted-engine.md`, `config.test.ts`).

_Host-side proxy (done + verified):_ `CLAUDEROOMS_ENGINE_URL` puts the desktop
in hosted mode. `hosted-proxy.ts` serves the bundled web client from a loopback
origin (the host window never loads the hosted engine's code) and forwards
`/api` + `/ws` to the hosted engine — dialing the WebSocket with the **hosted**
Origin so the engine's allow-list stays tight. The bridge dials the hosted
engine directly. Verified against a real hosted engine whose allow-list
contains only its own origin: static comes from the proxy, a room is created
through it, and the WS authenticates end-to-end — which only works because the
proxy sets the hosted Origin (`hosted-proxy.test.ts`, 3 tests).

_Remaining (the physical half of the acceptance):_ a real TLS-fronted
deployment on a public host and a guest join over an actual network — the
mechanism is proven locally; this needs infrastructure, not code. **Accepted
when:** a downloaded app hosts a room a remote guest can join from another
network.

## Milestone 7 — Safe write actions

One narrowly scoped write action (create file in a safe directory / edit an
explicitly selected file / run a predefined test command) behind explicit
per-action host approval, with full audit trail. ActionProposal model.
**Accepted when:** nothing executes before approval; approval binds to one
proposal; rejected actions never run; results reported accurately.

## Milestone 8 — Claude Desktop/Code integration (additive)

A ClaudeRooms MCP server so the host's Claude Desktop or Claude Code can
talk to rooms (post updates, read decisions), plus the optional terminal
"pro mode" (session mirror via Claude Code hooks). Decisions exported to
`.clauderooms/DECISIONS.md` for automatic context in future sessions.

## Deferred / follow-ups

Browser-level Playwright E2E; PostgreSQL adapter; decision supersession UI;
Windows/Linux packaging; invitation regeneration.
