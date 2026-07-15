# Data model (MVP)

All ids are UUIDv4. Timestamps are ISO-8601 UTC strings.

## rooms

| field               | notes                                                  |
| ------------------- | ------------------------------------------------------ |
| id                  | PK                                                     |
| name                | display name                                           |
| status              | `open` \| `ended`                                      |
| hostParticipantId   | the host's participant id                              |
| repositoryName      | optional; provided by bridge (M2+), never a local path |
| branchName          | optional                                               |
| createdAt / endedAt |                                                        |

## participants

| field             | notes                                                |
| ----------------- | ---------------------------------------------------- |
| id                | PK                                                   |
| roomId            | FK                                                   |
| displayName       | guest identity for MVP; no accounts                  |
| role              | `host` \| `collaborator`                             |
| sessionTokenHash  | sha256 of the session token; raw token returned once |
| joinedAt / leftAt |                                                      |
| connected         | derived from live sockets, broadcast as presence     |

## invitations

| field               | notes                                                           |
| ------------------- | --------------------------------------------------------------- |
| id                  | PK                                                              |
| roomId              | FK                                                              |
| tokenHash           | sha256; raw token shown once to host, carried in URL _fragment_ |
| expiresAt           | default 24h                                                     |
| revokedAt           | set when host ends room or revokes                              |
| maxUses / usedCount | default maxUses 10                                              |

## messages

| field               | notes                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| id                  | PK                                                                      |
| roomId              | FK                                                                      |
| authorType          | `human` \| `claude` \| `system`                                         |
| authorParticipantId | null for claude/system                                                  |
| messageType         | `human` \| `claude_request` \| `claude_response` \| `system` \| `error` |
| content             | plain text, ≤ 8000 chars                                                |
| requestId           | links request/response messages to claude_requests                      |
| createdAt           |                                                                         |

## claude_requests

| field                                               | notes                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| id                                                  | PK                                                                                          |
| roomId / createdByParticipantId                     |                                                                                             |
| content                                             | the prompt as submitted                                                                     |
| mode                                                | `discussion_only` (M1) · later `repository_read` / `repository_write` / `command_execution` |
| status                                              | `pending` → `running` → `completed` \| `failed` \| `cancelled`                              |
| requestedAt / startedAt / completedAt / failureCode |                                                                                             |

## decisions

| field                                            | notes                                                       |
| ------------------------------------------------ | ----------------------------------------------------------- |
| id                                               | PK                                                          |
| roomId                                           | FK                                                          |
| title / statement / rationale                    |                                                             |
| status                                           | `proposed` → `accepted` \| `rejected` (later: `superseded`) |
| createdByParticipantId / resolvedByParticipantId |                                                             |
| sourceMessageId                                  | optional link to the originating message                    |
| createdAt / resolvedAt                           |                                                             |

Valid transitions are enforced in `decisions.ts`; anything else is rejected
with `INVALID_TRANSITION`.

## room_events

Append-only log: `roomId`, `sequence` (per-room, monotonically increasing,
assigned inside the write transaction), `eventId`, `type`, `payloadJson`,
`actorType`, `actorId`, `occurredAt`. Used for broadcast ordering, reconnect
catch-up (`sinceSequence`), and audit. `claude.delta` events are **not**
persisted (ephemeral stream frames); everything else is.

## Deliberately absent

- User accounts / avatars (guest identities only in MVP).
- `ActionProposal` table ships in Milestone 4/5 together with the first real
  repository capability — the protocol reserves the event names now.
- Full local filesystem paths never appear in any table.
