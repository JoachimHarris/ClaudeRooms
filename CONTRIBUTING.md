# Contributing to ClaudeRooms

Thanks for helping! ClaudeRooms is pre-alpha; scope discipline matters more
than feature count.

## Setup

```bash
corepack enable          # provides pnpm
pnpm install
pnpm dev                 # server :3001 + web :5173
pnpm test && pnpm lint && pnpm typecheck && pnpm build
```

Note: pre-alpha runs the server from TypeScript source via `tsx`; the server
package's `build` script is a full compile check (`tsc --noEmit`), and
`apps/web` produces a real production bundle via Vite.

## Architecture principles (non-negotiable)

1. **Trust boundaries are sacred.** Everything from a browser is validated
   with zod in `packages/shared`. Roles come from session tokens
   server-side — never from client payloads.
2. **Explicit AI invocation.** No code path may send ordinary chat to a
   Claude adapter.
3. **The server never touches the host filesystem** on behalf of a room.
   Repository access belongs to the (future) local bridge, gated by host
   approval.
4. **No secrets in logs or storage.** Tokens are hashed at rest and redacted
   in logs.
5. **Prefer a thin vertical slice** over broad stubs. Don't add abstractions
   before two real uses exist.

## Code standards

- Strict TypeScript, no `any` (lint-enforced).
- Domain logic out of UI components; authorization out of presentation code.
- Comments explain _why_, not what.
- New behavior needs tests: domain rules → unit; anything crossing the
  protocol → integration; security boundaries → a test in
  `apps/server/test/security.test.ts`.

## Branches and PRs

- Branch from `main`; keep PRs small and coherent.
- Fill in the PR template, including the **security impact** section.
- CI (lint, typecheck, test, build) must be green.

## Security issues

Never open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).

## Scope

Check [docs/product/mvp-scope.md](docs/product/mvp-scope.md) before proposing
features; the non-goals list is deliberate. Consequential design changes need
an ADR in `docs/decisions/`.
