// Bundles the Electron main + preload scripts.
//
// main is ESM (.mjs): the Claude Agent SDK is ESM-only, so a CommonJS main
// process cannot require() it. Preload stays CommonJS (.cjs) because
// sandboxed preload scripts must be CJS. Workspace TypeScript is bundled in;
// anything shipping its own binaries or native bits stays external and is
// resolved from node_modules at runtime.
import { rm } from "node:fs/promises";
import { build } from "esbuild";

// Clean first so stale output (e.g. a previous CJS main) can never be loaded.
await rm("dist", { recursive: true, force: true });

const external = [
  "electron",
  // Ships the Claude Code CLI binary — must not be bundled.
  "@anthropic-ai/claude-agent-sdk",
  "ws",
];

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  external,
  sourcemap: true,
});

await build({
  entryPoints: ["src/preload.cts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  external,
  sourcemap: true,
});
