import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { FakeClaudeAdapter } from "./claude/fake-adapter.js";

const config = loadConfig();
const { app } = await buildServer({
  config,
  adapter: new FakeClaudeAdapter(120),
  logger: true,
  // Only pass when set — exactOptionalPropertyTypes rejects explicit undefined.
  ...(config.staticDir ? { staticDir: config.staticDir } : {}),
});

// Loopback by default; a hosted deployment sets CLAUDEROOMS_HOST=0.0.0.0 and is
// expected to sit behind a TLS-terminating proxy (ADR-0010). The engine speaks
// plain HTTP/WS — never expose it to the network without TLS in front.
const host = config.host ?? "127.0.0.1";
await app.listen({ port: config.port, host });
if (host !== "127.0.0.1" && host !== "localhost") {
  app.log.warn(
    `ClaudeRooms engine bound to ${host} — ensure a TLS proxy is in front (no built-in TLS).`,
  );
}
app.log.info(`ClaudeRooms engine listening on http://${host}:${config.port}`);
