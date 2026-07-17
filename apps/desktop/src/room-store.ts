import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// Durable list of the rooms this host has created (ADR-0008).
//
// Host session tokens are credentials, so the file is encrypted with
// Electron's safeStorage (OS keychain-backed) whenever the OS provides it.
// If it does not, we refuse to persist rather than write plaintext tokens to
// disk — rooms then behave as they did before Milestone 4 (session-scoped).
//
// The absolute repository path is deliberately *not* stored: it stays in
// main.ts for the current session only, exactly as in ADR-0007. A room
// restored after a restart therefore has display metadata but no repo path
// until the host picks the folder again — a conscious trade rather than
// silently persisting a filesystem path.

const storedRoomSchema = z.object({
  roomId: z.string().uuid(),
  roomName: z.string().min(1).max(200),
  repositoryName: z.string().max(100).nullable(),
  branchName: z.string().max(200).nullable(),
  displayName: z.string().min(1).max(80),
  participantId: z.string().uuid(),
  sessionToken: z.string().min(20).max(200),
  inviteToken: z.string().min(20).max(200).nullable(),
  inviteExpiresAt: z.string().nullable(),
  createdAt: z.string(),
  lastOpenedAt: z.string(),
});

const storeFileSchema = z.object({
  version: z.literal(1),
  rooms: z.array(storedRoomSchema).max(200),
});

export type StoredRoom = z.infer<typeof storedRoomSchema>;

/** What the renderer may see: everything except the credentials. */
export type RoomSummary = Omit<StoredRoom, "sessionToken" | "inviteToken">;

export function toSummary(room: StoredRoom): RoomSummary {
  const { sessionToken: _token, inviteToken: _invite, ...summary } = room;
  return summary;
}

export class RoomStore {
  private readonly filePath: string;
  private rooms: StoredRoom[] = [];

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(app.getPath("userData"), "rooms.bin");
  }

  /** True when the OS can encrypt at rest; false disables persistence. */
  get canPersist(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  load(): void {
    if (!this.canPersist) {
      this.rooms = [];
      return;
    }
    let decrypted: string;
    try {
      decrypted = safeStorage.decryptString(fs.readFileSync(this.filePath));
    } catch {
      // Missing, unreadable, or encrypted under a key we no longer have
      // (e.g. keychain reset). Start clean rather than crash.
      this.rooms = [];
      return;
    }
    const parsed = storeFileSchema.safeParse(safeJsonParse(decrypted));
    this.rooms = parsed.success ? parsed.data.rooms : [];
  }

  private persist(): void {
    if (!this.canPersist) return;
    const payload: z.infer<typeof storeFileSchema> = { version: 1, rooms: this.rooms };
    const encrypted = safeStorage.encryptString(JSON.stringify(payload));
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // 0600: even encrypted, the file is nobody else's business.
    fs.writeFileSync(this.filePath, encrypted, { mode: 0o600 });
  }

  list(): StoredRoom[] {
    return [...this.rooms].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  get(roomId: string): StoredRoom | null {
    return this.rooms.find((room) => room.roomId === roomId) ?? null;
  }

  save(room: StoredRoom): void {
    const parsed = storedRoomSchema.parse(room);
    this.rooms = [...this.rooms.filter((r) => r.roomId !== parsed.roomId), parsed];
    this.persist();
  }

  touch(roomId: string): void {
    const room = this.get(roomId);
    if (!room) return;
    this.save({ ...room, lastOpenedAt: new Date().toISOString() });
  }

  /** Removes a room and its credentials from disk. */
  forget(roomId: string): void {
    this.rooms = this.rooms.filter((room) => room.roomId !== roomId);
    this.persist();
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
