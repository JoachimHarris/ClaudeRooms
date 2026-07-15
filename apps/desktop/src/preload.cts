// Preload runs sandboxed with contextIsolation: the renderer gets exactly
// this narrow, typed surface and nothing else (no Node, no Electron APIs).
// CommonJS file (sandboxed preloads cannot be ESM), hence import=require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require("electron");

electron.contextBridge.exposeInMainWorld("clauderooms", {
  appVersion: "0.1.0",
  pickRepo: () => electron.ipcRenderer.invoke("clauderooms:pick-repo"),
});
