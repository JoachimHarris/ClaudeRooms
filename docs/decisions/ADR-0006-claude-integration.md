# ADR-0006: Fake-first Claude adapter, then the Claude Agent SDK

## Status

Accepted (2026-07-15)

## Context

See docs/research/claude-integration-options.md for the verified capability
survey.

## Decision

All Claude access goes through a small `ClaudeAdapter` interface
(`startSession` implicit for MVP; `submitRequest(...): AsyncIterable<ClaudeEvent>`,
`cancelRequest`, `close`). Milestone 1 ships only `FakeClaudeAdapter`
(deterministic, streamed, no network). Milestone 3 adds
`AgentSdkClaudeAdapter` on `@anthropic-ai/claude-agent-sdk`, running in the
local bridge: `canUseTool` + `PreToolUse` hooks implement the host-approval
model; `permissionMode: "plan"` for discussion-only; credentials remain on
the host via the user's Claude Code login.

## Consequences

The entire collaboration loop is testable without paid API calls; the
domain model never depends on SDK response shapes; swapping/upgrading the SDK
touches one module.

## Alternatives considered

Raw Messages API (reimplements the tool harness and permission semantics we
get for free); driving the interactive Claude Code TUI (unsupported,
brittle); building on plugins alone (plugins cannot host the transport).
