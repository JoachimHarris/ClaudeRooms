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

electron-builder packaging (macOS first): engine child process, web bundle
served via the server's `staticDir`, sqlite-for-Electron ABI resolution,
signing/notarization. A lightweight relay so invitation links work across
networks (server component hosted, bridge connects outbound; TLS).
**Accepted when:** a downloaded ClaudeRooms.app hosts a room a remote guest
can join from any network.

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
