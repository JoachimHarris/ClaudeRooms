// Bridge injected by the desktop app's preload script (apps/desktop).
// Present only when the UI runs inside ClaudeRooms.app — the plain browser
// build never sees it, which is how the UI distinguishes host from guest.

interface DesktopRepoInfo {
  repositoryName: string;
  branchName: string | null;
}

/** A remembered room as the rail sees it: never any credentials. */
interface DesktopRoomSummary {
  roomId: string;
  roomName: string;
  repositoryName: string | null;
  branchName: string | null;
  displayName: string;
  participantId: string;
  createdAt: string;
  lastOpenedAt: string;
}

interface DesktopRoomCredentials {
  sessionToken: string;
  participantId: string;
  inviteToken: string | null;
  inviteExpiresAt: string | null;
}

interface ClaudeRoomsDesktopBridge {
  appVersion: string;
  /** Opens a native folder picker; resolves null if the user cancels. */
  pickRepo: () => Promise<DesktopRepoInfo | null>;
  /** `canPersist` is false when the OS cannot encrypt at rest (ADR-0008). */
  listRooms: () => Promise<{ canPersist: boolean; rooms: DesktopRoomSummary[] }>;
  rememberRoom: (input: {
    roomId: string;
    roomName: string;
    repositoryName: string | null;
    branchName: string | null;
    displayName: string;
    participantId: string;
    sessionToken: string;
    inviteToken: string | null;
    inviteExpiresAt: string | null;
  }) => Promise<{ ok: boolean; persisted?: boolean; reason?: string }>;
  openRoom: (input: { roomId: string }) => Promise<DesktopRoomCredentials | null>;
  forgetRoom: (input: { roomId: string }) => Promise<{ ok: boolean }>;
  /** Lets the main process run Claude for this room (see apps/desktop). */
  startBridge: (input: {
    roomId: string;
    sessionToken: string;
  }) => Promise<{ ok: boolean; reason?: string }>;
  stopBridge: () => Promise<{ ok: boolean }>;
  /** Applies an approved write on the host machine (M7); host UI only. */
  applyWrite: (input: {
    path: string;
    content: string;
  }) => Promise<{ ok: boolean; path?: string; reason?: string }>;
}

interface Window {
  clauderooms?: ClaudeRoomsDesktopBridge;
}
