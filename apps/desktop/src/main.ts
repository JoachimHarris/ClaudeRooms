import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

// ClaudeRooms host application (Milestone 2).
//
// Dev stage: the window loads the Vite dev server, which proxies to the
// collaboration server — `pnpm dev` at the repo root starts all three.
// Packaged mode (engine child process + static web bundle via the server's
// `staticDir` option) lands with Milestone 4; until then a packaged binary
// exits with a clear message instead of pretending to work.
const RENDERER_URL = process.env.CLAUDEROOMS_RENDERER_URL ?? "http://localhost:5173";

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
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The window shows our own UI only. External links (e.g. GitHub) open in
  // the system browser; navigating the window itself elsewhere is denied.
  const allowedOrigin = new URL(RENDERER_URL).origin;
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

  void window.loadURL(RENDERER_URL);
  window.webContents.once("did-finish-load", () => {
    console.log(`[clauderooms] renderer loaded from ${RENDERER_URL}`);
  });
}

app.whenReady().then(async () => {
  if (app.isPackaged) {
    dialog.showErrorBox(
      "ClaudeRooms",
      "Packaged mode is not implemented yet (Milestone 4). Run from source with `pnpm dev`.",
    );
    app.quit();
    return;
  }
  try {
    await waitForRenderer(RENDERER_URL, 120_000);
  } catch (error) {
    console.error("[clauderooms]", error);
    app.quit();
    return;
  }
  createWindow();
  console.log("[clauderooms] host window created");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
