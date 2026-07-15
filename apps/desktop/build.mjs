// Bundles the Electron main + preload scripts. Workspace TypeScript is
// bundled in; real dependencies (electron, and later the engine process)
// stay external and resolve from node_modules at runtime.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  external: ["electron"],
  sourcemap: true,
};

await build({ ...common, entryPoints: ["src/main.ts"] });
await build({ ...common, entryPoints: ["src/preload.cts"] });
