// Preload runs sandboxed with contextIsolation: the renderer gets exactly
// this narrow, typed surface and nothing else (no Node, no Electron APIs).
// CommonJS file (sandboxed preloads cannot be ESM), hence import=require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require("electron");

electron.contextBridge.exposeInMainWorld("clauderooms", {
  appVersion: "0.1.0",
  pickRepo: () => electron.ipcRenderer.invoke("clauderooms:pick-repo"),
  // The host's remembered rooms (ADR-0008). listRooms returns summaries
  // only; credentials come back from openRoom, for one room at a time.
  listRooms: () => electron.ipcRenderer.invoke("clauderooms:list-rooms"),
  rememberRoom: (input: unknown) =>
    electron.ipcRenderer.invoke("clauderooms:remember-room", input),
  openRoom: (input: { roomId: string }) =>
    electron.ipcRenderer.invoke("clauderooms:open-room", input),
  forgetRoom: (input: { roomId: string }) =>
    electron.ipcRenderer.invoke("clauderooms:forget-room", input),
  // Hands the host session token to the main process so it can open the
  // Claude bridge. Main owns the repo path and the SDK; the renderer never
  // touches either.
  startBridge: (input: { roomId: string; sessionToken: string }) =>
    electron.ipcRenderer.invoke("clauderooms:start-bridge", input),
  stopBridge: () => electron.ipcRenderer.invoke("clauderooms:stop-bridge"),
});
