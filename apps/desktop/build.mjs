// Bundles the Electron main + preload scripts.
//
// main is ESM (.mjs): the Claude Agent SDK is ESM-only, so a CommonJS main
// process cannot require() it. Preload stays CommonJS (.cjs) because
// sandboxed preload scripts must be CJS. Workspace TypeScript is bundled in;
// anything shipping its own binaries or native bits stays external and is
// resolved from node_modules at runtime.
import { cp, rm, stat } from "node:fs/promises";
import { build } from "esbuild";

// Clean first so stale output (e.g. a previous CJS main) can never be loaded.
await rm("dist", { recursive: true, force: true });

const external = [
  "electron",
  // Ships the Claude Code CLI binary — must not be bundled.
  "@anthropic-ai/claude-agent-sdk",
  "ws",
  // The embedded engine (ADR-0009). Its workspace TypeScript is bundled in,
  // but these resolve from node_modules at runtime: better-sqlite3 is native
  // (rebuilt for Electron's ABI at packaging time), and Fastify + its plugins
  // do dynamic requires that esbuild cannot safely inline.
  "better-sqlite3",
  "fastify",
  "@fastify/websocket",
  "@fastify/static",
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

// The packaged runtime serves the built web client from `dist/web` (ADR-0009).
// Copy it in from apps/web so the desktop bundle is self-contained. Dev never
// reads this (it loads Vite), but a clear error beats a silent 404 in prod.
const webDist = "../web/dist";
try {
  await stat(`${webDist}/index.html`);
  await cp(webDist, "dist/web", { recursive: true });
} catch {
  console.warn(
    `[build] ${webDist}/index.html not found — run \`pnpm --filter @clauderooms/web build\` before packaging`,
  );
}
