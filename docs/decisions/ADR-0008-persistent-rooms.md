# ADR-0008: Persistent rooms, and where host credentials live

## Status

Accepted (2026-07-17)

## Context

Rooms have been one-shot: host credentials lived in `sessionStorage` and died
with the tab, so every restart meant a new room. The product direction is the
opposite — a workspace you return to, with your rooms pinned in a left rail
(Milestone 4). That requires rooms to survive an app restart, which requires
host session tokens to survive too. Tokens are credentials, so this moves a
security boundary and needs a decision on the record rather than a quiet
`localStorage.setItem`.

An account system would be the "normal" answer, but it contradicts the
local-first thesis and is far more machinery than the problem needs.

## Decision

1. **The app remembers, not the server.** The Electron main process owns a
   durable list of `{roomId, display metadata, participantId, sessionToken,
inviteToken}`. No accounts, no server-side identity, no new endpoint: the
   engine still mints independent per-room participants and knows nothing
   about "my rooms".
2. **Encrypted at rest, or not at all.** The store is written via Electron's
   `safeStorage` (OS keychain-backed), file mode `0600`. If
   `safeStorage.isEncryptionAvailable()` is false, we **do not persist** and
   log it — rooms degrade to the old session-scoped behaviour. There is no
   plaintext fallback.
3. **Least privilege across the preload bridge.** `listRooms` returns
   summaries with **no credentials** (that is all the rail needs).
   `openRoom(roomId)` returns the tokens for exactly one room, when the host
   opens it. The renderer already holds the token of a room it created, so
   this is the same trust level — not a new exposure.
4. **The repository path is still never persisted.** ADR-0007 keeps the
   absolute path in the main process for the current session only. A
   remembered room reopens with its name and branch, but Claude has no repo
   path until the host picks the folder again. Deliberate: a stored path is a
   durable pointer at the user's filesystem, and the cost (re-pick) is small.
5. **Forgetting is a first-class action.** `forgetRoom` removes the room and
   its credentials from disk; ending a room does not silently keep its
   tokens.

## Consequences

- Rooms survive restarts, unlocking the Milestone 4 rail without an accounts
  system.
- Host tokens now exist on disk (encrypted). Threat model gains rows for
  local disk compromise, keychain unavailability, and stale-credential
  hygiene.
- A room whose engine database was deleted (or whose tokens were revoked)
  will fail to authenticate on open; the rail must show that state honestly
  rather than looking broken. Until the rail exists, the room page shows "no
  access".
- Restored rooms need the bridge re-attached on open — otherwise Claude
  silently degrades to the fake adapter.

## Alternatives considered

- **Accounts / server-side room list** — contradicts local-first, adds auth
  machinery, and would make the engine know who "you" are across rooms.
- **Plaintext JSON in userData** — simplest, and how many Electron apps do
  it. Rejected: a readable file of live host tokens is exactly the thing an
  attacker with local read access wants, and "it's just localhost" is not an
  argument once tokens outlive the session.
- **Storing the repo path too** — convenient (rooms would fully restore), but
  persists a filesystem pointer for a gain that one folder-pick already buys.
  Revisit only with a strong reason.
