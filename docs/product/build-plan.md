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

## Milestone 2 — Desktop host app ✅ (this repo state)

The host experience moves into ClaudeRooms.app (Electron; ADR-0007):
native repository picker (name + branch only — the absolute path never
leaves the app process), room creation from the app, browser demoted to
guest-join only. Protocol validates repository metadata against path
smuggling.
**Accepted when:** `pnpm dev` opens the app; the host creates a room with
repo metadata without touching a browser or terminal command; the guest
flow still works in a plain browser; the server never sees an absolute
path; all checks green.

## Milestone 3 — Real Claude in the app

`AgentSdkClaudeAdapter` (Claude Agent SDK) driven by the app's engine
process against the picked repository. Discussion-only first, then
repository read. Hybrid timeline: collapsible work cards for Claude's
steps, side panel for changes + approvals. Cancellation, error/rate-limit
states. Fake adapter remains the test default; no paid calls in CI.
**Accepted when:** a room request produces a real streamed Claude response
grounded in the picked repo; every capability beyond discussion requires
host approval in the app; credentials stay on the host.

## Milestone 4 — Packaged app + remote guests

electron-builder packaging (macOS first): engine child process, web bundle
served via the server's `staticDir`, sqlite-for-Electron ABI resolution,
signing/notarization. A lightweight relay so invitation links work across
networks (server component hosted, bridge connects outbound; TLS).
**Accepted when:** a downloaded ClaudeRooms.app hosts a room a remote guest
can join from any network.

## Milestone 5 — Safe write actions

One narrowly scoped write action (create file in a safe directory / edit an
explicitly selected file / run a predefined test command) behind explicit
per-action host approval, with full audit trail. ActionProposal model.
**Accepted when:** nothing executes before approval; approval binds to one
proposal; rejected actions never run; results reported accurately.

## Milestone 6 — Claude Desktop/Code integration (additive)

A ClaudeRooms MCP server so the host's Claude Desktop or Claude Code can
talk to rooms (post updates, read decisions), plus the optional terminal
"pro mode" (session mirror via Claude Code hooks). Decisions exported to
`.clauderooms/DECISIONS.md` for automatic context in future sessions.

## Deferred / follow-ups

Browser-level Playwright E2E; PostgreSQL adapter; decision supersession UI;
Windows/Linux packaging; invitation regeneration.
