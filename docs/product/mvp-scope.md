# MVP scope

Revised 2026-07-15 for the desktop-first direction (ADR-0007).

## In scope

1. **Host in the desktop app**: pick a repository folder, create a room, and
   collaborate — no terminal, no browser required for the host.
2. **Guests in the browser**: secure, expiring, revocable invitation links
   (token in URL fragment, hashed at rest); zero install for collaborators.
3. Real-time chat with presence, ordering, and reconnect catch-up.
4. Explicit "Ask Claude" requests, clearly distinguished from human chat.
5. Streamed Claude responses in the shared room (fake adapter first, real
   Agent SDK adapter working on the picked repository in Milestone 3).
6. Hybrid timeline: one shared track; Claude's detailed work renders as
   collapsible work cards (Milestone 3), changes/approvals summarized in a
   side panel.
7. Action proposals with host-only approval for sensitive categories
   (architecture in place from day one; first real write action in
   Milestone 5).
8. Decisions as structured objects: propose → accept/reject, visible in a
   decisions panel.
9. Room lifecycle: end room, revoke invitations, preserve history locally
   (SQLite).
10. Audit trail: every request, approval, and action is an event.

## Out of scope (non-goals for MVP)

Slack replacement, org-wide channels, DMs, voice/video/screen share, SSO,
billing, mobile apps, project management, Kanban, cloud IDE, collaborative
text editing, multi-agent orchestration, autonomous deployment, marketplaces,
long-term semantic memory, support for non-Claude agents, and end-to-end
encryption (unless it can be done correctly — it cannot yet).

Removed from this list 2026-07-15: ~~Electron apps~~ — the desktop app _is_
the host experience now (ADR-0007). A standalone browser-hosted "create room
on localhost" flow is no longer a product surface.

## Definition of "MVP works"

The host opens ClaudeRooms.app, picks a repository, creates a room, and
invites a collaborator, who joins from a plain browser. They chat, ask
Claude explicitly, see the streamed response, capture a decision, and end
the room — with unauthorized access rejected and the E2E test proving the
loop.
