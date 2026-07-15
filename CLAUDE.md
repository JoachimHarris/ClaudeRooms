# CLAUDE.md — operational guide for Claude Code sessions in this repo

## What this is

ClaudeRooms: an open-source multiplayer collaboration layer for Claude Code.
Humans + Claude in one shared room around a repository, with explicit Claude
invocation, host-approved actions, and decisions as first-class objects.
**Not affiliated with or endorsed by Anthropic** — keep that notice intact in
README and UI.

## Current stage

Milestone 1 complete (local rooms, chat, fake Claude adapter, decisions).
Next: Milestone 2 (local bridge). Roadmap: `docs/product/build-plan.md`.
Product truth lives in `docs/product/`, architecture in `docs/architecture/`,
security in `docs/security/threat-model.md`, decisions in `docs/decisions/`.

## Layout

- `packages/shared` — domain types + zod protocol. **Single source of truth
  for the wire format**; change it here first, never ad-hoc in apps.
- `apps/server` — Fastify + WebSocket + SQLite. `src/rooms.ts` (domain),
  `src/ws.ts` (transport), `src/claude/` (adapter boundary), `src/db.ts`.
- `apps/web` — Vite + React SPA, plain CSS tokens, hand-rolled 3-route
  router.

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
