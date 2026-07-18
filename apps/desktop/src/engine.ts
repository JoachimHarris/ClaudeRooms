import type { AddressInfo } from "node:net";
import { buildServer, type BuiltServer } from "@clauderooms/server";

// The embedded collaboration engine (Milestone 6, ADR-0009). In a packaged
// app there is no separate `apps/server` process and no Vite: the host shell
// runs the engine in-process on loopback and serves the built web client from
// it. Kept free of any `electron` import so it can be started and tested under
// plain Node — the packaged path and the test both exercise the same code.

export interface EmbeddedEngine {
  /** http origin the window loads from (also the WS origin). */
  origin: string;
  /** ws URL the host bridge dials to run Claude against this engine. */
  bridgeUrl: string;
  close: () => Promise<void>;
}

export async function startEmbeddedEngine(options: {
  dbPath: string;
  staticDir: string;
}): Promise<EmbeddedEngine> {
  // The origin is not known until the OS assigns a port, but the server reads
  // `config.allowedOrigins` per request — so we hand it this array now and push
  // the real origin in once we have it, before any window can connect.
  const allowedOrigins: string[] = [];
  const built: BuiltServer = await buildServer({
    config: { port: 0, dbPath: options.dbPath, allowedOrigins },
    staticDir: options.staticDir,
    logger: false,
  });

  await built.app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = built.app.server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  allowedOrigins.push(origin);

  return {
    origin,
    bridgeUrl: `ws://127.0.0.1:${port}/bridge`,
    close: () => built.app.close(),
  };
}
