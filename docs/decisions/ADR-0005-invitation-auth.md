# ADR-0005: Invitation and session authentication

## Status

Accepted (2026-07-15)

## Context

MVP needs secure joining without building an account system.

## Decision

- Invitation tokens: 256-bit random, base64url; stored as sha256 hash;
  expire after 24h; max 10 uses; revoked when the room ends. Carried in the
  URL **fragment** (`/join/:roomId#token`) so they never hit server logs.
- Session tokens: 256-bit random, minted per participant at create/join,
  stored hashed, presented in the first WebSocket frame (never query
  strings). Role (`host`/`collaborator`) derives from the token server-side.
- No accounts, passwords, or OAuth in MVP; display names are self-asserted
  guest identities.

## Consequences

Rooms are inaccessible without a token; leaked links have bounded blast
radius (expiry, use cap, revocation); adding real identity later replaces the
minting step, not the transport.

## Alternatives considered

Room-id-as-secret (explicitly forbidden by the brief); JWT (adds key
management for no benefit at this scale); full auth platform (premature).
