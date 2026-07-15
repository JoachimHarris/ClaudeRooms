import { z } from "zod";
import { ERROR_CODES, LIMITS } from "./domain.js";

// Every payload that crosses a trust boundary is validated with the schemas
// in this file. Server and client both parse — no untyped JSON on the wire.

// ---------------------------------------------------------------------------
// Shared views
// ---------------------------------------------------------------------------

export const roomViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(["open", "ended"]),
  repositoryName: z.string().nullable(),
  branchName: z.string().nullable(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
});

export const participantViewSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  displayName: z.string(),
  role: z.enum(["host", "collaborator"]),
  joinedAt: z.string(),
  connected: z.boolean(),
});

export const messageViewSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  authorType: z.enum(["human", "claude", "system"]),
  authorParticipantId: z.string().uuid().nullable(),
  messageType: z.enum(["human", "claude_request", "claude_response", "system", "error"]),
  content: z.string(),
  requestId: z.string().uuid().nullable(),
  createdAt: z.string(),
});

export const claudeRequestViewSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  createdByParticipantId: z.string().uuid(),
  content: z.string(),
  mode: z.literal("discussion_only"),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  requestedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  failureCode: z.string().nullable(),
});

export const decisionViewSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  title: z.string(),
  statement: z.string(),
  rationale: z.string().nullable(),
  status: z.enum(["proposed", "accepted", "rejected"]),
  createdByParticipantId: z.string().uuid(),
  resolvedByParticipantId: z.string().uuid().nullable(),
  sourceMessageId: z.string().uuid().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Room events (server → client envelopes)
// ---------------------------------------------------------------------------

const actorSchema = z.object({
  type: z.enum(["human", "claude", "system"]),
  id: z.string().uuid().optional(),
});

export const eventPayloadSchemas = {
  "participant.joined": z.object({ participant: participantViewSchema }),
  "participant.left": z.object({ participantId: z.string().uuid() }),
  "participant.presence_changed": z.object({
    participantId: z.string().uuid(),
    connected: z.boolean(),
  }),
  "message.created": z.object({ message: messageViewSchema }),
  "claude.requested": z.object({ request: claudeRequestViewSchema }),
  "claude.started": z.object({ requestId: z.string().uuid() }),
  "claude.delta": z.object({ requestId: z.string().uuid(), text: z.string() }),
  "claude.completed": z.object({
    requestId: z.string().uuid(),
    message: messageViewSchema,
  }),
  "claude.failed": z.object({
    requestId: z.string().uuid(),
    failureCode: z.string(),
    message: z.string(),
  }),
  "decision.proposed": z.object({ decision: decisionViewSchema }),
  "decision.accepted": z.object({ decision: decisionViewSchema }),
  "decision.rejected": z.object({ decision: decisionViewSchema }),
  "room.ended": z.object({
    roomId: z.string().uuid(),
    endedByParticipantId: z.string().uuid(),
  }),
} as const;

export type RoomEventType = keyof typeof eventPayloadSchemas;

export type RoomEventPayload<T extends RoomEventType> = z.infer<
  (typeof eventPayloadSchemas)[T]
>;

/** Events that are broadcast live but never persisted or sequenced. */
export const EPHEMERAL_EVENT_TYPES: readonly RoomEventType[] = [
  "claude.delta",
  "participant.presence_changed",
];

const eventTypeSchema = z.enum(
  Object.keys(eventPayloadSchemas) as [RoomEventType, ...RoomEventType[]],
);

export const protocolEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(1),
    eventId: z.string().uuid(),
    roomId: z.string().uuid(),
    sequence: z.number().int().positive().optional(),
    type: eventTypeSchema,
    payload: z.unknown(),
    actor: actorSchema,
    occurredAt: z.string(),
  })
  .superRefine((envelope, ctx) => {
    const schema = eventPayloadSchemas[envelope.type];
    const result = schema.safeParse(envelope.payload);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `invalid payload for ${envelope.type}`,
        path: ["payload"],
      });
    }
  });

export interface ProtocolEnvelope<T extends RoomEventType = RoomEventType> {
  protocolVersion: 1;
  eventId: string;
  roomId: string;
  sequence?: number;
  type: T;
  payload: RoomEventPayload<T>;
  actor: z.infer<typeof actorSchema>;
  occurredAt: string;
}

// ---------------------------------------------------------------------------
// Client → server frames
// ---------------------------------------------------------------------------

const contentSchema = z.string().min(1).max(LIMITS.maxMessageLength);

export const clientFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auth"),
    protocolVersion: z.number().int(),
    token: z.string().min(20).max(200),
    sinceSequence: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal("chat.send"), content: contentSchema }),
  z.object({
    type: z.literal("claude.request"),
    content: contentSchema,
    mode: z.literal("discussion_only"),
  }),
  z.object({
    type: z.literal("decision.propose"),
    title: z.string().min(1).max(LIMITS.maxDecisionTitleLength),
    statement: z.string().min(1).max(LIMITS.maxDecisionTextLength),
    rationale: z.string().max(LIMITS.maxDecisionTextLength).optional(),
    sourceMessageId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal("decision.resolve"),
    decisionId: z.string().uuid(),
    status: z.enum(["accepted", "rejected"]),
  }),
  z.object({ type: z.literal("room.end") }),
  z.object({ type: z.literal("ping") }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

// ---------------------------------------------------------------------------
// Server → client frames
// ---------------------------------------------------------------------------

export const errorCodeSchema = z.enum(ERROR_CODES);

export const serverFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auth.ok"),
    room: roomViewSchema,
    self: participantViewSchema,
    participants: z.array(participantViewSchema),
    decisions: z.array(decisionViewSchema),
    events: z.array(protocolEnvelopeSchema),
  }),
  z.object({ type: z.literal("event"), event: protocolEnvelopeSchema }),
  z.object({ type: z.literal("pong") }),
  z.object({
    type: z.literal("error"),
    code: errorCodeSchema,
    message: z.string(),
  }),
]);

export type ServerFrame = z.infer<typeof serverFrameSchema>;

// ---------------------------------------------------------------------------
// Bridge protocol (host ↔ engine, separate /bridge endpoint)
//
// The bridge is how the host machine runs Claude against the local repository
// without the engine ever seeing the repo path or credentials. Only the room
// host (verified by session token) may connect. The engine forwards Claude
// requests to the bridge; the bridge streams responses back. This is a
// distinct frame set from the room protocol to keep the trust boundary sharp.
// ---------------------------------------------------------------------------

const requestIdSchema = z.string().uuid();

/** host → engine */
export const bridgeClientFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bridge.auth"),
    protocolVersion: z.number().int(),
    token: z.string().min(20).max(200),
  }),
  z.object({ type: z.literal("bridge.started"), requestId: requestIdSchema }),
  z.object({
    type: z.literal("bridge.delta"),
    requestId: requestIdSchema,
    text: z.string().max(LIMITS.maxMessageLength),
  }),
  z.object({
    type: z.literal("bridge.completed"),
    requestId: requestIdSchema,
    text: z.string().max(LIMITS.maxMessageLength),
  }),
  z.object({
    type: z.literal("bridge.failed"),
    requestId: requestIdSchema,
    failureCode: z.string().max(80),
    message: z.string().max(500),
  }),
  z.object({ type: z.literal("bridge.ping") }),
]);

export type BridgeClientFrame = z.infer<typeof bridgeClientFrameSchema>;

/** engine → host */
export const bridgeServerFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bridge.ready"),
    roomId: z.string().uuid(),
    repositoryName: z.string().nullable(),
  }),
  z.object({
    type: z.literal("bridge.request"),
    requestId: requestIdSchema,
    content: z.string().max(LIMITS.maxMessageLength),
    mode: z.literal("discussion_only"),
  }),
  z.object({ type: z.literal("bridge.cancel"), requestId: requestIdSchema }),
  z.object({ type: z.literal("bridge.pong") }),
  z.object({
    type: z.literal("bridge.error"),
    code: errorCodeSchema,
    message: z.string(),
  }),
]);

export type BridgeServerFrame = z.infer<typeof bridgeServerFrameSchema>;

// ---------------------------------------------------------------------------
// HTTP bodies and responses
// ---------------------------------------------------------------------------

const displayNameSchema = z.string().trim().min(1).max(LIMITS.maxNameLength);

// Repository metadata is *display metadata only*. It must never be able to
// smuggle a local filesystem path to the server: no separators in the repo
// name, no traversal or leading slash in the branch name.
const repositoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^/\\]+$/, "repository name must not contain path separators")
  .refine((value) => !value.startsWith("."), {
    message: "repository name must not start with a dot",
  });

const branchNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\w./-]+$/, "branch name contains invalid characters")
  .refine((value) => !value.includes("..") && !value.startsWith("/"), {
    message: "branch name must not traverse paths",
  });

export const createRoomBodySchema = z.object({
  roomName: z.string().trim().min(1).max(LIMITS.maxNameLength),
  displayName: displayNameSchema,
  repositoryName: repositoryNameSchema.optional(),
  branchName: branchNameSchema.optional(),
});

export const joinRoomBodySchema = z.object({
  inviteToken: z.string().min(20).max(200),
  displayName: displayNameSchema,
});

export const createRoomResponseSchema = z.object({
  room: roomViewSchema,
  participant: participantViewSchema,
  sessionToken: z.string(),
  inviteToken: z.string(),
  inviteExpiresAt: z.string(),
});

export const joinRoomResponseSchema = z.object({
  room: roomViewSchema,
  participant: participantViewSchema,
  sessionToken: z.string(),
});

export const apiErrorSchema = z.object({
  error: z.object({ code: errorCodeSchema, message: z.string() }),
});
