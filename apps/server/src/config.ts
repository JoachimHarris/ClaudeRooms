import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  port: number;
  dbPath: string;
  allowedOrigins: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.CLAUDEROOMS_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CLAUDEROOMS_PORT: ${env.CLAUDEROOMS_PORT}`);
  }
  const dbPath =
    env.CLAUDEROOMS_DB && env.CLAUDEROOMS_DB.length > 0
      ? env.CLAUDEROOMS_DB
      : path.join(here, "..", "data", "clauderooms.db");
  const allowedOrigins = (env.CLAUDEROOMS_ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return { port, dbPath, allowedOrigins };
}
