import type { ClaudeRequestMode } from "@clauderooms/shared";

// The only doorway between ClaudeRooms and any Claude integration. The
// domain model never sees SDK response shapes; adapters translate.

export interface ClaudeRequestInput {
  requestId: string;
  roomId: string;
  content: string;
  mode: ClaudeRequestMode;
}

export type ClaudeAdapterEvent =
  | { type: "started" }
  | { type: "delta"; text: string }
  | { type: "completed"; text: string }
  | { type: "failed"; failureCode: string; message: string }
  // Repo-relative paths Claude was allowed to open, for the room's audit.
  | { type: "repo_access"; files: string[] };

export interface ClaudeAdapter {
  submitRequest(input: ClaudeRequestInput): AsyncIterable<ClaudeAdapterEvent>;
  cancelRequest(requestId: string): Promise<void>;
  close(): Promise<void>;
}
