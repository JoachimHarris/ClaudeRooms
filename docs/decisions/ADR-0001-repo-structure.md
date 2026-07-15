# ADR-0001: Minimal monorepo structure

## Status

Accepted (2026-07-15)

## Context

The master brief proposes up to nine workspace packages. We have one server,
one web client, and shared types; extra packages would be ceremony without a
second consumer.

## Decision

pnpm workspace with `apps/server`, `apps/web`, `packages/shared`. The local
bridge, CLI, and Claude adapter start as modules (`apps/server/src/claude/`,
later `apps/server/src/bridge/`) and are promoted to packages when a second
consumer exists (the M2 CLI will likely trigger `packages/local-bridge`).

## Consequences

Fewer moving parts for contributors; boundary discipline is enforced by
convention + lint rather than package walls until promotion.

## Alternatives considered

Full nine-package layout (premature); single package (loses the shared
protocol as an explicit contract between client and server).
