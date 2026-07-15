# ClaudeRooms — product brief

**Tagline:** Multiplayer collaboration for Claude Code.

ClaudeRooms is an open-source collaboration layer that puts humans and Claude
in the same room around the same repository. It is not affiliated with or
endorsed by Anthropic.

## Problem

Development collaboration with an AI agent is fragmented today: one person
works with Claude Code, then manually relays what happened into Slack/Teams,
collaborators respond without the coding context, and decisions are copied
back by hand. Reasoning, decisions, code changes, and human discussion end up
disconnected.

## Promise (MVP)

> Invite another person into a collaborative room connected to your Claude
> Code workflow.

A host starts ClaudeRooms from a local repository, creates a room, and shares
an invitation link. Both humans exchange real-time messages, explicitly send
selected requests to Claude, see Claude's responses and proposed actions in
the shared room, approve or reject sensitive actions, and preserve important
decisions as structured, durable project context.

## What makes it different

- **Explicit AI invocation.** Ordinary chat never reaches Claude. A Claude
  request is a deliberate, auditable act.
- **The host's machine is sacred.** A local bridge is the only component with
  repository access; remote participants and the collaboration server never
  get direct local execution rights.
- **Decisions are first-class objects**, not formatting conventions in chat.
- **Approvals are scoped**: to one request or one action, never "trust
  everyone forever".

## Primary users

- **Host developer** — runs Claude Code and the ClaudeRooms bridge locally,
  owns the repository connection and all approvals.
- **Collaborator** — joins via browser link; can discuss, address Claude, and
  propose decisions, but cannot touch the host's machine.
- **Claude** — a participant with capabilities granted per request by the
  host, never an unrestricted administrator.

## Status

Pre-alpha. Local-first, self-hosted, not production ready. See
[mvp-scope.md](mvp-scope.md) and [build-plan.md](build-plan.md).
