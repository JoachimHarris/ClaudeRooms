# Build plan

Small, demonstrable milestones. Each is done only when its acceptance
criteria pass (tests + lint + typecheck + build green).

## Milestone 0 — Repository foundation ✅

pnpm workspace, strict TypeScript, ESLint + Prettier, Vitest, GitHub Actions
CI, open-source files (LICENSE Apache-2.0, CONTRIBUTING, SECURITY,
CODE_OF_CONDUCT, templates), initial docs, CLAUDE.md.
**Accepted when:** clean install; lint, typecheck, tests, build all pass.

## Milestone 1 — Local collaborative room, fake Claude ✅ (this repo state)

Create room, hashed expiring invitations, join, presence, real-time chat,
explicit Ask-Claude with streamed fake response, decisions
(propose/accept/reject by host), end room, SQLite persistence, reconnect
catch-up, rate/size limits.
**Accepted when:** two browser sessions collaborate; ordering stable;
reconnect restores state; plain chat never invokes Claude; unauthorized users
rejected; host can end room; E2E flow test passes (integration test driving
two real WS clients through the full loop; browser-level Playwright E2E is a
follow-up).

## Milestone 2 — Local bridge

`clauderooms start` CLI in a repo: repo/branch/status detection, outbound
authenticated bridge connection, online/offline state in the room,
path-boundary utilities + security tests, capability reporting. No writes.
**Accepted when:** room shows repo metadata; server never sees absolute
paths; bridge reconnects; path-boundary security tests pass.

## Milestone 3 — Real Claude (discussion only)

`AgentSdkClaudeAdapter` on `@anthropic-ai/claude-agent-sdk` in the bridge;
streaming, cancellation, error/rate-limit handling; fake adapter remains the
test default.
**Accepted when:** a room request gets a real streamed Claude response;
chat is never auto-sent; credentials stay on the host; default test suite
makes no paid calls (live test separately gated).

## Milestone 4 — Repository-aware requests

`repository_read` mode with host authorization, structured scope, shared
summaries, redaction (deny-list `.env*`, keys, hidden files by policy),
audit events, ActionProposal model.
**Accepted when:** collaborator cannot read arbitrary files; access stays in
root; room shows that repository access occurred; approval unforgeable
client-side.

## Milestone 5 — Safe action approval

One narrowly scoped write action (create file in a safe directory / edit one
selected file / run a predefined test command) behind explicit host approval,
with full audit.
**Accepted when:** nothing executes before approval; approval binds to one
proposal; rejected actions never run; results reported accurately.

## Milestone 6 — Claude Code plugin

`/clauderooms:start|status|share|end` skills wrapping the CLI, packaged per
current plugin conventions; install docs.
**Accepted when:** clean install from repo; room startable from Claude Code;
plugin cannot weaken local authorization.

## Deferred / follow-ups

Browser-level Playwright E2E; streaming over SSE fallback; PostgreSQL
adapter; decision supersession UI; dark-mode polish; hosted deployment story.
