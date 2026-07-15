import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { openDatabase, type AppDatabase } from "./db.js";
import { RoomService } from "./rooms.js";
import { RoomHub } from "./hub.js";
import { registerHttpRoutes } from "./http.js";
import { registerWs } from "./ws.js";
import type { ClaudeAdapter } from "./claude/adapter.js";
import { FakeClaudeAdapter } from "./claude/fake-adapter.js";
import type { ServerConfig } from "./config.js";

export interface BuiltServer {
  app: FastifyInstance;
  rooms: RoomService;
  hub: RoomHub;
  db: AppDatabase;
}

export async function buildServer(options: {
  config: ServerConfig;
  adapter?: ClaudeAdapter;
  logger?: boolean;
}): Promise<BuiltServer> {
  const app = Fastify({
    logger: options.logger
      ? {
          level: "info",
          // Belt and braces: tokens are never logged on purpose, and these
          // redactions catch accidental object logging.
          redact: {
            paths: [
              "req.headers.authorization",
              "*.sessionToken",
              "*.inviteToken",
              "*.token",
            ],
            censor: "[redacted]",
          },
        }
      : false,
    bodyLimit: 64 * 1024,
  });

  const db = openDatabase(options.config.dbPath);
  const rooms = new RoomService(db);
  const adapter = options.adapter ?? new FakeClaudeAdapter();
  const hub = new RoomHub(rooms, adapter);

  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 },
  });
  await app.register(async (instance) => {
    registerWs(instance, { rooms, hub, config: options.config });
  });
  registerHttpRoutes(app, { rooms, hub });

  app.addHook("onClose", async () => {
    await adapter.close();
    db.close();
  });

  return { app, rooms, hub, db };
}
