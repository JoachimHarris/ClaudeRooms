// Per-room credentials.
//
// Guests (plain browser): sessionStorage — keeps tokens out of URLs and out
// of long-lived localStorage; closing the tab forgets them.
//
// Host (desktop app): the Electron main process owns the durable, encrypted
// room store (ADR-0008), so credentials are fetched from there. We still
// mirror them into sessionStorage so a reload inside the app is instant and
// the room page needs no async bootstrap.

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

/**
 * Resolves credentials for a room, asking the desktop app for a remembered
 * room when this tab has none (e.g. after an app restart). Returns null when
 * the room is unknown to both — the caller then shows "no access".
 */
export async function resolveSession(roomId: string): Promise<StoredSession | null> {
  const local = loadSession(roomId);
  if (local) return local;

  const credentials = await window.clauderooms?.openRoom({ roomId });
  if (!credentials) return null;

  const session: StoredSession = {
    sessionToken: credentials.sessionToken,
    participantId: credentials.participantId,
    ...(credentials.inviteToken ? { inviteToken: credentials.inviteToken } : {}),
    ...(credentials.inviteExpiresAt
      ? { inviteExpiresAt: credentials.inviteExpiresAt }
      : {}),
  };
  saveSession(roomId, session);
  return session;
}
