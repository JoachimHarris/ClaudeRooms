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

**Step 2 — wiring.** `repository_read` in the protocol, host approval before
a request runs, `canUseTool` consulting the policy per tool call, audit
events, and the work cards.

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
