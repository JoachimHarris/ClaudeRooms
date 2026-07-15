# Threat model (MVP)

Scope: Milestones 0–3 (collaboration loop, local-first server, discussion-only
Claude). Revisit before Milestone 4 (repository read) and 5 (writes).

## Assets

Host's machine and repository; API/Claude credentials on the host; room
history (may contain sensitive discussion); invitation and session tokens.

## Principals

Host (trusted, owns the machine), collaborator (semi-trusted: allowed to talk,
never to execute), Claude output (untrusted input!), anonymous network
attacker, a compromised collaboration server (assumed possible in the design
of the bridge).

## Threats and mitigations

| Threat                                                        | Mitigation                                                                                                                                                                                                                              | Status                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Unauthorized room access / predictable ids                    | Rooms are unreachable without a 256-bit invitation or session token; room ids are never authorization                                                                                                                                   | M1 ✅ tested            |
| Invitation link leakage                                       | Tokens expire (24h), are use-limited, revocable, carried in URL fragment (not logged), stored only as sha256                                                                                                                            | M1 ✅ tested            |
| Replay of captured session token                              | Tokens are per-participant, hashed at rest, invalidated when the room ends; TLS is required for any non-localhost deployment (documented)                                                                                               | M1 ✅                   |
| Impersonation / forged role                                   | Role is looked up server-side from the session token; role/ids in client frames are ignored                                                                                                                                             | M1 ✅ tested            |
| Collaborator self-approving as host                           | `decision.resolve`, `room.end` (and later `action.approve`) require the token-derived role `host`                                                                                                                                       | M1 ✅ tested            |
| Prompt injection via room messages                            | Ordinary chat is never sent to Claude; only explicit requests are. Claude output is rendered as plain text (React escaping, no raw HTML/Markdown rendering in M1) and treated as untrusted                                              | M1 ✅                   |
| XSS via message content                                       | No `dangerouslySetInnerHTML`; content rendered as text nodes; security test posts script payloads and asserts inert round-trip                                                                                                          | M1 ✅ tested            |
| Oversized / malformed payloads, DoS                           | 16 KiB frame cap before parse, zod validation, per-connection token-bucket rate limit, sensitive HTTP endpoints rate-limited                                                                                                            | M1 ✅ tested            |
| WebSocket hijacking / CSWSH                                   | Auth happens in the first WS frame with the session token — an origin-forged socket without the token gets nothing; Origin allowlist on upgrade                                                                                         | M1 ✅                   |
| Secrets in logs                                               | Raw tokens never logged or stored; structured logger redacts `token`/`authorization` fields                                                                                                                                             | M1 ✅                   |
| Arbitrary command execution from chat                         | No path from any room message to local execution. The Claude adapter in M1 executes nothing; from M3 the bridge only enables tools per approved request                                                                                 | by construction         |
| Path traversal / symlink escape / `.env` & credential leakage | No filesystem access exists until M2+; the bridge will resolve+validate every path against the repo root, refuse symlinks escaping it, and deny-list `.env*`, `.git/config`, key material. Security tests are an acceptance gate for M2 | designed, not yet built |
| Compromised collaboration server                              | Bridge connects outbound, holds credentials locally, and independently re-validates every action against host approvals; server never stores repo content or credentials                                                                | designed (M2+)          |
| Misleading approval requests (collaborator tricks host)       | Approval UI shows requester, exact scope/command, and risk category — never buried in chat                                                                                                                                              | designed (M5)           |
| Dependency supply chain                                       | Small dependency set, lockfile committed, CI installs with frozen lockfile                                                                                                                                                              | M0 ✅                   |
| Absolute local path smuggled via repo metadata                | Desktop app sends display metadata only (basename + branch); protocol rejects separators/traversal in `repositoryName`/`branchName`; the absolute path never leaves the Electron main process                                           | M2 ✅ tested            |
| Renderer escape / Electron attack surface                     | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; single narrow preload bridge (`pickRepo` only); window navigation locked to the app origin; external links open in the system browser                              | M2 ✅                   |
| Malicious room content reaching the desktop shell             | The app window renders the same web client with the same plain-text-only rendering; the preload bridge exposes no filesystem or shell surface to room content                                                                           | M2 ✅                   |

## Standing rules

Treat all room content as untrusted input; validate at every boundary; fail
closed when authorization is uncertain; never send environment variables to a
room; never render model-supplied HTML; keep an audit trail of approvals and
actions; development-only bypasses must be explicit, visually obvious, off by
default, and impossible to enable in production (none exist today).

## Known accepted gaps (pre-alpha)

- No TLS termination built in — localhost by default; anything else must sit
  behind a TLS proxy (README warns).
- Session tokens live in browser `sessionStorage`; acceptable while we ship
  zero third-party scripts, revisit before any hosted offering.
- No persistent user identity — display names are self-asserted; the host
  sees join events and can end the room.
