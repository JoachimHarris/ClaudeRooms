import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Plain SQL migrations, applied at startup, tracked via PRAGMA user_version.
// Append new migrations to the array — never edit an applied one.

const MIGRATIONS: string[] = [
  `
  CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    host_participant_id TEXT,
    repository_name TEXT,
    branch_name TEXT,
    created_at TEXT NOT NULL,
    ended_at TEXT
  );

  CREATE TABLE participants (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    session_token_hash TEXT NOT NULL UNIQUE,
    joined_at TEXT NOT NULL,
    left_at TEXT
  );
  CREATE INDEX idx_participants_room ON participants(room_id);

  CREATE TABLE invitations (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    max_uses INTEGER NOT NULL,
    used_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_invitations_room ON invitations(room_id);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    author_type TEXT NOT NULL,
    author_participant_id TEXT,
    message_type TEXT NOT NULL,
    content TEXT NOT NULL,
    request_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_messages_room ON messages(room_id, created_at);

  CREATE TABLE claude_requests (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    created_by TEXT NOT NULL,
    content TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    failure_code TEXT
  );

  CREATE TABLE decisions (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    title TEXT NOT NULL,
    statement TEXT NOT NULL,
    rationale TEXT,
    status TEXT NOT NULL,
    created_by TEXT NOT NULL,
    resolved_by TEXT,
    source_message_id TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX idx_decisions_room ON decisions(room_id);

  CREATE TABLE room_events (
    room_id TEXT NOT NULL REFERENCES rooms(id),
    sequence INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    occurred_at TEXT NOT NULL,
    PRIMARY KEY (room_id, sequence)
  );
  `,
];

export type AppDatabase = Database.Database;

export function openDatabase(dbPath: string): AppDatabase {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const version = db.pragma("user_version", { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    const migration = MIGRATIONS[i];
    if (!migration) continue;
    db.transaction(() => {
      db.exec(migration);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  return db;
}
