import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { HostBridge } from "./bridge-client.js";
import { RoomStore, toSummary, type StoredRoom } from "./room-store.js";
import { startEmbeddedEngine, type EmbeddedEngine } from "./engine.js";

// main runs as ESM (the Agent SDK is ESM-only), so __dirname must be derived.
const here = path.dirname(fileURLToPath(import.meta.url));

// ClaudeRooms host application.
//
// Two runtimes (ADR-0009):
// - Dev: the window loads the Vite dev server and the engine is a separate
//   `apps/server` process — `pnpm dev` at the repo root starts all three.
// - Packaged: the engine runs in THIS process on loopback and serves the built
//   web client from `staticDir`; the window loads from that same origin.
// `rendererOrigin` and `engineBridgeUrl` are resolved once at startup and used
// by the window and the host bridge; everything downstream is mode-agnostic.
const DEV_RENDERER_URL = process.env.CLAUDEROOMS_RENDERER_URL ?? "http://localhost:5173";
const DEV_ENGINE_PORT = Number(process.env.CLAUDEROOMS_PORT ?? 3001);

// Packaged unless we are clearly running from source; the env var lets us
// exercise the packaged runtime under `electron .` without a full build.
const isPackagedRuntime = () => app.isPackaged || process.env.CLAUDEROOMS_PROD === "1";

let rendererOrigin = DEV_RENDERER_URL;
let engineBridgeUrl = `ws://localhost:${DEV_ENGINE_PORT}/bridge`;
let embeddedEngine: EmbeddedEngine | null = null;

// Without this, userData is derived from the package name and becomes
// "~/Library/Application Support/@clauderooms/desktop". Set before any
// getPath("userData") call — the room store depends on it.
app.setName("ClaudeRooms");

/**
 * The absolute repository path never leaves this process: the renderer and
 * the collaboration server only ever receive display metadata (name +
 * branch). The path itself is kept here for the Milestone 3 Claude engine.
 */
let currentRepoPath: string | null = null;

export function getCurrentRepoPath(): string | null {
  return currentRepoPath;
}

/** Reads the current branch from .git/HEAD without shelling out. */
function readBranch(repoPath: string): string | null {
  try {
    const head = fs.readFileSync(path.join(repoPath, ".git", "HEAD"), "utf8").trim();
    const match = head.match(/^ref: refs\/heads\/(.+)$/);
    return match?.[1] ?? null; // detached HEAD → no branch name
  } catch {
    return null; // not a git repository — still fine to host a room
  }
}

// The host's durable room list (ADR-0008). Created after `app.whenReady`,
// because it needs userData paths and the OS keychain.
let roomStore: RoomStore | null = null;

function requireRoomStore(): RoomStore {
  if (!roomStore) throw new Error("room store used before app was ready");
  return roomStore;
}

const rememberRoomInputSchema = z.object({
  roomId: z.string().uuid(),
  roomName: z.string().min(1).max(200),
  repositoryName: z.string().max(100).nullable(),
  branchName: z.string().max(200).nullable(),
  displayName: z.string().min(1).max(80),
  participantId: z.string().uuid(),
  sessionToken: z.string().min(20).max(200),
  inviteToken: z.string().min(20).max(200).nullable(),
  inviteExpiresAt: z.string().nullable(),
});

const roomIdInputSchema = z.object({ roomId: z.string().uuid() });

/** Rail data: summaries only — credentials stay in the main process. */
ipcMain.handle("clauderooms:list-rooms", async () => {
  const store = requireRoomStore();
  return { canPersist: store.canPersist, rooms: store.list().map(toSummary) };
});

ipcMain.handle("clauderooms:remember-room", async (_event, raw: unknown) => {
  const parsed = rememberRoomInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid input" };
  const now = new Date().toISOString();
  const room: StoredRoom = { ...parsed.data, createdAt: now, lastOpenedAt: now };
  requireRoomStore().save(room);
  return { ok: true, persisted: requireRoomStore().canPersist };
});

/**
 * Hands back the credentials for one room so the renderer can connect. The
 * renderer already holds these for rooms it just created; this is the same
 * trust level, not a new exposure — but only ever for the room being opened.
 */
ipcMain.handle("clauderooms:open-room", async (_event, raw: unknown) => {
  const parsed = roomIdInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const store = requireRoomStore();
  const room = store.get(parsed.data.roomId);
  if (!room) return null;
  store.touch(room.roomId);
  return {
    sessionToken: room.sessionToken,
    participantId: room.participantId,
    inviteToken: room.inviteToken,
    inviteExpiresAt: room.inviteExpiresAt,
  };
});

ipcMain.handle("clauderooms:forget-room", async (_event, raw: unknown) => {
  const parsed = roomIdInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };
  requireRoomStore().forget(parsed.data.roomId);
  return { ok: true };
});

// One bridge at a time: the app hosts a single room per window today.
let bridge: HostBridge | null = null;

const startBridgeInputSchema = z.object({
  roomId: z.string().uuid(),
  // The renderer holds the host session token (it created the room); it is
  // handed over once so the bridge can prove host role to the engine.
  sessionToken: z.string().min(20).max(200),
});

ipcMain.handle("clauderooms:start-bridge", async (_event, raw: unknown) => {
  const parsed = startBridgeInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid input" };

  bridge?.stop();
  bridge = new HostBridge({
    engineUrl: engineBridgeUrl,
    token: parsed.data.sessionToken,
    getRepoPath: () => currentRepoPath,
    onStatus: (status) => console.log(`[clauderooms] bridge ${status}`),
  });
  bridge.start();
  return { ok: true };
});

ipcMain.handle("clauderooms:stop-bridge", async () => {
  bridge?.stop();
  bridge = null;
  return { ok: true };
});

ipcMain.handle("clauderooms:pick-repo", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose repository folder",
    buttonLabel: "Use this repository",
    properties: ["openDirectory"],
  });
  const repoPath = result.filePaths[0];
  if (result.canceled || !repoPath) return null;
  currentRepoPath = repoPath;
  return {
    repositoryName: path.basename(repoPath),
    branchName: readBranch(repoPath),
  };
});

async function waitForRenderer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok || response.status === 404) return;
    } catch {
      /* dev server not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`Renderer at ${url} did not become ready in ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    title: "ClaudeRooms",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The window shows our own UI only. External links (e.g. GitHub) open in
  // the system browser; navigating the window itself elsewhere is denied.
  const allowedOrigin = new URL(rendererOrigin).origin;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== allowedOrigin) {
      event.preventDefault();
      if (url.startsWith("https://")) void shell.openExternal(url);
    }
  });

  void window.loadURL(rendererOrigin);
  window.webContents.once("did-finish-load", () => {
    console.log(`[clauderooms] renderer loaded from ${rendererOrigin}`);
  });
}

app.whenReady().then(async () => {
  roomStore = new RoomStore();
  roomStore.load();
  if (!roomStore.canPersist) {
    // Honest degradation: rooms still work, they just will not survive a
    // restart. Never fall back to writing tokens as plaintext.
    console.warn(
      "[clauderooms] OS encryption unavailable — rooms will not be remembered",
    );
  }

  if (isPackagedRuntime()) {
    // Packaged: run the engine in-process and serve the built web client from
    // it (ADR-0009). No dev servers; the window and bridge both point at the
    // engine's loopback origin.
    try {
      embeddedEngine = await startEmbeddedEngine({
        dbPath: path.join(app.getPath("userData"), "clauderooms.db"),
        staticDir: path.join(here, "web"),
      });
      rendererOrigin = embeddedEngine.origin;
      engineBridgeUrl = embeddedEngine.bridgeUrl;
      console.log(`[clauderooms] embedded engine on ${embeddedEngine.origin}`);
    } catch (error) {
      console.error("[clauderooms] embedded engine failed to start", error);
      dialog.showErrorBox(
        "ClaudeRooms",
        "The collaboration engine failed to start. See logs for details.",
      );
      app.quit();
      return;
    }
  } else {
    // Dev: wait for the Vite renderer; the engine is a separate process.
    try {
      await waitForRenderer(rendererOrigin, 120_000);
    } catch (error) {
      console.error("[clauderooms]", error);
      app.quit();
      return;
    }
  }
  createWindow();
  console.log(
    `[clauderooms] host window created (${roomStore.list().length} remembered rooms)`,
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

// Shut the embedded engine down cleanly so its SQLite handle is released.
app.on("will-quit", (event) => {
  if (!embeddedEngine) return;
  const engine = embeddedEngine;
  embeddedEngine = null;
  event.preventDefault();
  void engine.close().finally(() => app.quit());
});
