# ADR-0003: SQLite via better-sqlite3, event log without event sourcing

## Status

Accepted (2026-07-15)

## Context

Local-first MVP needs zero-ops durable storage with strict ordering.

## Decision

`better-sqlite3` (synchronous, WAL mode, battle-tested prebuilds), plain SQL
migrations applied at startup, a thin repository layer (no ORM). An
append-only `room_events` table with a per-room sequence provides ordering,
reconnect catch-up, and audit; normalized tables remain the write model.
Both are written in one transaction — this is deliberately _not_ event
sourcing.

## Consequences

Simple deterministic tests against real SQLite (temp files); a later
PostgreSQL adapter means porting ~10 SQL statements behind the repository
boundary, not redesigning.

## Alternatives considered

`node:sqlite` (still experimental on Node 20/22 — noisy for contributors);
Prisma/Drizzle (generic data-access framework explicitly out of scope);
full event sourcing (write-model complexity with no current payoff).
