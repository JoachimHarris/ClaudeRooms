import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { FakeClaudeAdapter } from "./claude/fake-adapter.js";

const config = loadConfig();
const { app } = await buildServer({
  config,
  adapter: new FakeClaudeAdapter(120),
  logger: true,
});

// Localhost by default — see docs/security/threat-model.md before exposing
// this anywhere else (no built-in TLS).
await app.listen({ port: config.port, host: "127.0.0.1" });
app.log.info(`ClaudeRooms server listening on http://127.0.0.1:${config.port}`);
