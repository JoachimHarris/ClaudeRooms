# CLAUDE.md — operational guide for Claude Code sessions in this repo

## What this is

ClaudeRooms: an open-source multiplayer collaboration layer for Claude Code.
Humans + Claude in one shared room around a repository, with explicit Claude
invocation, host-approved actions, and decisions as first-class objects.
**Not affiliated with or endorsed by Anthropic** — keep that notice intact in
README and UI.

## Current stage

Milestone 6 in progress: packaged app + remote guests (ADR-0009). Milestone 5
is done — a host-approved `repository_read` lets Claude read the repo under
`RepoAccessPolicy` (the gate is only enforced because every tool is forced onto
`settings.permissions.ask`), with absolute-path redaction and a collapsible
work card. M6 makes the engine deployable embedded (packaged app, loopback) or
hosted (cloud, remote guests). Step 1 (engine serves the built web client via
`staticDir`) and step 2 (the package: `engine.ts` runs the engine in-process,
`electron-builder --dir` builds a working `ClaudeRooms.app`) are done —
verified the packaged app self-hosts a room with no dev servers. Note:
`pnpm run package` rebuilds the workspace `better-sqlite3` for Electron's ABI,
so run `pnpm rebuild -r better-sqlite3` afterward to restore dev/tests. Step 3
(remote guests) mechanism is complete and verified locally: ADR-0010 decides
the security-critical topology (host loads only local trusted UI; the desktop
main proxies room data to a hosted engine, dialing its WS with the hosted
Origin; the engine never sees repo/credentials/host-window code). The
hosted-engine deploy surface (`CLAUDEROOMS_HOST`/`STATIC_DIR`) and the host-side
proxy (`hosted-proxy.ts`, `CLAUDEROOMS_ENGINE_URL`) are done and tested against
a real hosted engine; only a real public TLS deployment + cross-network join
remain (infrastructure, not code). Real Claude runs on the host via the Agent
SDK inside the desktop app (delegated over `/bridge`), with dark/light theming
and a persistent left rail of rooms backed by an encrypted room store
(ADR-0008). Hosts use the Electron app (`apps/desktop`); browsers are
guest-join only. Roadmap: `docs/product/build-plan.md`.
Product truth lives in `docs/product/`, architecture in `docs/architecture/`,
security in `docs/security/threat-model.md`, decisions in `docs/decisions/`.

## Layout

- `packages/shared` — domain types + zod protocol. **Single source of truth
  for the wire format**; change it here first, never ad-hoc in apps.
- `apps/server` — Fastify + WebSocket + SQLite engine. `src/rooms.ts`
  (domain), `src/ws.ts` (transport), `src/claude/` (adapter boundary),
  `src/lib.ts` (embedding entry for the desktop app).
- `apps/web` — Vite + React SPA. Renders inside the desktop app (host mode,
  detected via `window.clauderooms`) and in plain browsers (guest mode).
- `apps/desktop` — Electron host app. `src/main.ts` keeps the absolute repo
  path; only display metadata crosses to renderer/server. `src/claude-runner.ts`
  runs the real Claude (Agent SDK) — **its four discussion-only gates are
  load-bearing and were each proven necessary; do not remove one without
  re-running the CLAUDE.md leak test**. For `repository_read` the same gates
  stay except tool availability (`Read`/`Glob`), with every call routed through
  `canUseTool` → `checkToolCall` in `src/tool-gate.ts`. **`canUseTool` only
  runs because every available tool is forced onto `settings.permissions.ask`;
  without that line the SDK auto-approves reads in the default permission mode
  and the policy is silently bypassed (proven in live testing — `.env` was
  readable). Do not remove it.** All output is run through `redactRepoRoots`
  so the host's absolute path never reaches the engine (proven necessary —
  Claude echoed it in testing). `tool-gate.ts` is
  kept SDK-free so the security logic is unit-testable. `src/bridge-client.ts`
  connects outbound to the engine. `src/room-store.ts` holds host credentials
  encrypted via `safeStorage` — **never add a plaintext fallback** (ADR-0008).
  Security posture (contextIsolation, sandbox, navigation lock) must never be
  weakened.

## Commands

`pnpm dev` · `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm build`
(run all four checks before claiming anything works).

## Hard rules

1. **Never bypass permission/authorization checks**, even "temporarily for a
   demo". Roles derive from session tokens server-side only.
2. **Never create a path from ordinary chat to a Claude adapter** — Claude
   invocation must stay explicit.
3. **No secrets in logs, storage, or the room**: tokens hashed at rest; no
   env vars, credentials, or absolute local paths sent to clients.
4. **Validate at boundaries** with the shared zod schemas; reject, don't
   coerce.
5. **No raw HTML rendering** of any room content.
6. Strict TS, no `any`; tests for domain rules, protocol changes, and every
   security boundary you touch.

## What NOT to build

Anything in the non-goals list (`docs/product/mvp-scope.md`): DMs, channels,
video, SSO, billing, Kanban, cloud IDE, collaborative editing, multi-agent
orchestration. Prefer completing the current milestone's vertical slice.

## Working style

- Small coherent increments; keep `pnpm dev` runnable at all times.
- Consequential choices get an ADR; update the affected docs in the same
  change.
- Report completed work with: what changed, files touched, commands run,
  test/lint/typecheck/build results, what works / doesn't, security impact.
  Never claim green checks you didn't run.
