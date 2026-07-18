import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  port: number;
  /**
   * Bind address. Defaults to loopback — a hosted deployment opts in to
   * 0.0.0.0. Optional so embedded/test callers can omit it; only the
   * standalone entry (index.ts) reads it.
   */
  host?: string;
  dbPath: string;
  allowedOrigins: string[];
  /** When set, the engine also serves the built web client from here. */
  staticDir?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.CLAUDEROOMS_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CLAUDEROOMS_PORT: ${env.CLAUDEROOMS_PORT}`);
  }
  // Loopback by default: a public bind is a deliberate deployment choice, never
  // the accidental result of running the engine locally (threat model).
  const host =
    env.CLAUDEROOMS_HOST && env.CLAUDEROOMS_HOST.length > 0
      ? env.CLAUDEROOMS_HOST
      : "127.0.0.1";
  const dbPath =
    env.CLAUDEROOMS_DB && env.CLAUDEROOMS_DB.length > 0
      ? env.CLAUDEROOMS_DB
      : path.join(here, "..", "data", "clauderooms.db");
  const allowedOrigins = (env.CLAUDEROOMS_ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const config: ServerConfig = { port, host, dbPath, allowedOrigins };
  // Assigned only when set — `exactOptionalPropertyTypes` rejects an explicit
  // `undefined` on an optional field.
  if (env.CLAUDEROOMS_STATIC_DIR && env.CLAUDEROOMS_STATIC_DIR.length > 0) {
    config.staticDir = env.CLAUDEROOMS_STATIC_DIR;
  }
  return config;
}
