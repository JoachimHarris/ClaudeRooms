// Per-room credentials for this browser tab. sessionStorage keeps tokens out
// of URLs and out of long-lived localStorage; closing the tab forgets them.

export interface StoredSession {
  sessionToken: string;
  participantId: string;
  inviteToken?: string;
  inviteExpiresAt?: string;
}

const key = (roomId: string) => `clauderooms:${roomId}`;

export function saveSession(roomId: string, session: StoredSession): void {
  sessionStorage.setItem(key(roomId), JSON.stringify(session));
}

export function loadSession(roomId: string): StoredSession | null {
  const raw = sessionStorage.getItem(key(roomId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function clearSession(roomId: string): void {
  sessionStorage.removeItem(key(roomId));
}
