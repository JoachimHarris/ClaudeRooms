import type { ErrorCode } from "@clauderooms/shared";

/** Error that is safe to surface to clients: stable code + terse message. */
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case "ROOM_NOT_FOUND":
      return 404;
    case "NOT_AUTHORIZED":
      return 403;
    case "INVITATION_EXPIRED":
    case "INVITATION_REVOKED":
    case "INVITATION_EXHAUSTED":
    case "INVITATION_INVALID":
      return 403;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "RATE_LIMITED":
      return 429;
    case "INVALID_PAYLOAD":
    case "INVALID_TRANSITION":
    case "ROOM_ENDED":
    case "PROTOCOL_VERSION_UNSUPPORTED":
      return 400;
    default:
      return 500;
  }
}
