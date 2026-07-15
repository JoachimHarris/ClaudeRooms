// Domain vocabulary shared by server and client. These are the *public*
// views — nothing here may ever carry a token, a hash, or a local path.

export const PROTOCOL_VERSION = 1 as const;

export const LIMITS = {
  /** Max characters in a chat message or Claude request. */
  maxMessageLength: 8000,
  /** Max bytes for a single WebSocket frame, checked before parsing. */
  maxFrameBytes: 16 * 1024,
  maxNameLength: 80,
  maxDecisionTitleLength: 200,
  maxDecisionTextLength: 2000,
  /** Milliseconds a socket may stay unauthenticated before being closed. */
  authTimeoutMs: 5000,
  inviteTtlMs: 24 * 60 * 60 * 1000,
  inviteMaxUses: 10,
} as const;

export type RoomStatus = "open" | "ended";
export type Role = "host" | "collaborator";
export type AuthorType = "human" | "claude" | "system";
export type MessageType =
  "human" | "claude_request" | "claude_response" | "system" | "error";
export type ClaudeRequestMode = "discussion_only";
export type ClaudeRequestStatus =
  "pending" | "running" | "completed" | "failed" | "cancelled";
export type DecisionStatus = "proposed" | "accepted" | "rejected";

export interface RoomView {
  id: string;
  name: string;
  status: RoomStatus;
  repositoryName: string | null;
  branchName: string | null;
  createdAt: string;
  endedAt: string | null;
}

export interface ParticipantView {
  id: string;
  roomId: string;
  displayName: string;
  role: Role;
  joinedAt: string;
  connected: boolean;
}

export interface MessageView {
  id: string;
  roomId: string;
  authorType: AuthorType;
  authorParticipantId: string | null;
  messageType: MessageType;
  content: string;
  requestId: string | null;
  createdAt: string;
}

export interface ClaudeRequestView {
  id: string;
  roomId: string;
  createdByParticipantId: string;
  content: string;
  mode: ClaudeRequestMode;
  status: ClaudeRequestStatus;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureCode: string | null;
}

export interface DecisionView {
  id: string;
  roomId: string;
  title: string;
  statement: string;
  rationale: string | null;
  status: DecisionStatus;
  createdByParticipantId: string;
  resolvedByParticipantId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const ERROR_CODES = [
  "ROOM_NOT_FOUND",
  "ROOM_ENDED",
  "INVITATION_EXPIRED",
  "INVITATION_REVOKED",
  "INVITATION_EXHAUSTED",
  "INVITATION_INVALID",
  "NOT_AUTHORIZED",
  "INVALID_PAYLOAD",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "INVALID_TRANSITION",
  "REQUEST_TIMEOUT",
  "CLAUDE_UNAVAILABLE",
  "PROTOCOL_VERSION_UNSUPPORTED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
