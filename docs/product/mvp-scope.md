# MVP scope

## In scope

1. Create a room from a local machine; host + one or more collaborators.
2. Secure, expiring, revocable invitation links (token in URL fragment,
   hashed at rest).
3. Real-time human chat with presence, ordering, and reconnect catch-up.
4. Explicit "Ask Claude" requests, clearly distinguished from human chat.
5. Streamed Claude responses in the shared room (fake adapter first, real
   Agent SDK adapter in Milestone 3).
6. Action proposals with host-only approval for sensitive categories
   (architecture in place from day one; first real write action in
   Milestone 5).
7. Decisions as structured objects: propose → accept/reject, visible in a
   decisions panel.
8. Room lifecycle: end room, revoke invitations, preserve history locally
   (SQLite).
9. Audit trail: every request, approval, and action is an event.

## Out of scope (non-goals for MVP)

Slack replacement, org-wide channels, DMs, voice/video/screen share, SSO,
billing, mobile apps, project management, Kanban, cloud IDE, collaborative
text editing, multi-agent orchestration, autonomous deployment, marketplaces,
Electron apps, long-term semantic memory, support for non-Claude agents, and
end-to-end encryption (unless it can be done correctly — it cannot yet).

## Definition of "MVP works"

Two people in two browsers can run the full loop against a locally started
server: create → invite → join → chat → ask (fake) Claude → see streamed
response → propose and accept a decision → end room — with unauthorized
access rejected and the E2E test proving it.
