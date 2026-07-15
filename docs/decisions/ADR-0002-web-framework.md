# ADR-0002: Vite + React SPA instead of Next.js

## Status

Accepted (2026-07-15)

## Context

The brief prefers Next.js but allows alternatives with a clear reason. The
web app is a real-time, WebSocket-first room UI behind token auth: no SEO, no
SSR benefit, no server components needed — and invitation tokens live in the
URL fragment, which SSR never sees anyway.

## Decision

Vite + React + TypeScript SPA with a ~30-line hand-rolled router (3 routes).
Plain CSS with design tokens; no UI framework dependency.

## Consequences

Faster dev server, smaller dependency surface, simpler mental model for
contributors. If a marketing/docs site is needed later it lives elsewhere.

## Alternatives considered

Next.js (SSR machinery without a use case here); react-router (a dependency
for three static routes).
