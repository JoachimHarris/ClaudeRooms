// Bridge injected by the desktop app's preload script (apps/desktop).
// Present only when the UI runs inside ClaudeRooms.app — the plain browser
// build never sees it, which is how the UI distinguishes host from guest.

interface DesktopRepoInfo {
  repositoryName: string;
  branchName: string | null;
}

interface ClaudeRoomsDesktopBridge {
  appVersion: string;
  /** Opens a native folder picker; resolves null if the user cancels. */
  pickRepo: () => Promise<DesktopRepoInfo | null>;
  /** Lets the main process run Claude for this room (see apps/desktop). */
  startBridge: (input: {
    roomId: string;
    sessionToken: string;
  }) => Promise<{ ok: boolean; reason?: string }>;
  stopBridge: () => Promise<{ ok: boolean }>;
}

interface Window {
  clauderooms?: ClaudeRoomsDesktopBridge;
}
