# ADR-0004: WebSockets with a zod-validated typed protocol

## Status

Accepted (2026-07-15)

## Context

The room needs bidirectional real-time messaging with ordering and catch-up.

## Decision

Fastify + `@fastify/websocket` (`ws` underneath). One shared protocol module
(`packages/shared`) defines every frame and event with zod; both client and
server parse at runtime — no untyped JSON crosses a boundary. Auth is the
first WS frame (tokens never in URLs); server-assigned per-room sequence
numbers give total order; reconnect replays `sinceSequence`.

## Consequences

Single source of truth for the wire format; protocol version field (`1`)
allows evolution; SSE fallback can be added later without touching the
protocol schemas.

## Alternatives considered

Socket.IO (extra protocol layer + dependency weight); tRPC subscriptions
(couples us to a framework where a plain schema suffices).
