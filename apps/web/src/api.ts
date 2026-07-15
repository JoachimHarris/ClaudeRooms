import type { z } from "zod";
import {
  apiErrorSchema,
  createRoomResponseSchema,
  joinRoomResponseSchema,
  type ErrorCode,
} from "@clauderooms/shared";

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | "NETWORK",
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function postJson<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("NETWORK", "Could not reach the ClaudeRooms server.");
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    if (parsed.success) {
      throw new ApiError(parsed.data.error.code, parsed.data.error.message);
    }
    throw new ApiError("NETWORK", `Request failed (${response.status}).`);
  }
  return schema.parse(json);
}

export function createRoom(input: {
  roomName: string;
  displayName: string;
  repositoryName?: string;
  branchName?: string;
}) {
  return postJson("/api/rooms", input, createRoomResponseSchema);
}

export function joinRoom(input: {
  roomId: string;
  inviteToken: string;
  displayName: string;
}) {
  return postJson(
    `/api/rooms/${input.roomId}/join`,
    { inviteToken: input.inviteToken, displayName: input.displayName },
    joinRoomResponseSchema,
  );
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "INVITATION_EXPIRED":
        return "This invitation has expired. Ask the host for a new room.";
      case "INVITATION_REVOKED":
      case "ROOM_ENDED":
        return "This room has ended or the invitation was revoked.";
      case "INVITATION_EXHAUSTED":
        return "This invitation has been used too many times.";
      case "INVITATION_INVALID":
        return "This invitation link is not valid. Check that you copied the full link.";
      case "RATE_LIMITED":
        return "Too many attempts — wait a moment and try again.";
      case "NETWORK":
        return "Could not reach the server. Is `pnpm dev` running?";
      default:
        return error.message;
    }
  }
  return "Something went wrong.";
}
