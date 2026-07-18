import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { WebSocket, WebSocketServer } from "ws";

// The host-side proxy for a hosted room (ADR-0010). In hosted mode the desktop
// window must load LOCAL trusted UI — never the hosted engine's code, which
// could otherwise drive `window.clauderooms` (folder picker, `openRoom` →
// every remembered room's tokens). So we serve the bundled web client from a
// loopback origin and forward only room DATA to the hosted engine:
//   • /api/*  — proxied over HTTP,
//   • /ws     — proxied over WebSocket, dialed server-to-server with the
//               hosted Origin so the hosted engine's allow-list stays tight.
// The bridge dials the hosted /bridge directly (see main.ts); it does not pass
// through here. Nothing on the host's disk crosses this boundary.

export interface HostedProxy {
  /** Loopback origin the window loads from (same-origin for its /api + /ws). */
  origin: string;
  close: () => Promise<void>;
}

export async function startHostedProxy(options: {
  staticDir: string;
  /** Hosted engine base URL, e.g. https://rooms.example.com */
  engineUrl: string;
}): Promise<HostedProxy> {
  const engineHttp = options.engineUrl.replace(/\/+$/, "");
  const engineWs = engineHttp.replace(/^http/, "ws"); // http→ws, https→wss

  const app = Fastify({ bodyLimit: 64 * 1024 });

  // Forward the room HTTP API to the hosted engine. Only /api is proxied;
  // every other path is served locally as the static UI shell.
  app.all("/api/*", async (request, reply) => {
    try {
      const method = request.method.toUpperCase();
      const hasBody = method !== "GET" && method !== "HEAD";
      const init: RequestInit = {
        method,
        headers: { "content-type": "application/json" },
      };
      // Only set body when there is one — exactOptionalPropertyTypes rejects an
      // explicit `undefined` on RequestInit.body.
      if (hasBody) init.body = JSON.stringify(request.body ?? {});
      const upstream = await fetch(engineHttp + request.url, init);
      const text = await upstream.text();
      void reply
        .status(upstream.status)
        .header(
          "content-type",
          upstream.headers.get("content-type") ?? "application/json",
        )
        .send(text);
    } catch {
      void reply.status(502).send({
        error: { code: "NETWORK", message: "Could not reach the hosted engine." },
      });
    }
  });

  await app.register(fastifyStatic, { root: options.staticDir });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply
        .status(404)
        .send({ error: { code: "ROOM_NOT_FOUND", message: "Not found" } });
    }
    return reply.sendFile("index.html");
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  // Proxy the room WebSocket. The browser connects same-origin to us; we dial
  // the hosted engine with the hosted Origin header, so its origin allow-list
  // never has to include a loopback origin.
  const wss = new WebSocketServer({ noServer: true });
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", origin).pathname;
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      const upstream = new WebSocket(`${engineWs}/ws`, {
        headers: { origin: engineHttp },
      });
      const pending: string[] = [];
      let upstreamOpen = false;

      upstream.on("open", () => {
        upstreamOpen = true;
        for (const frame of pending) upstream.send(frame);
        pending.length = 0;
      });
      // The protocol is JSON text in both directions; forward as text.
      client.on("message", (data) => {
        const frame = data.toString();
        if (upstreamOpen) upstream.send(frame);
        else pending.push(frame);
      });
      upstream.on("message", (data) => client.send(data.toString()));

      const closeBoth = () => {
        try {
          client.close();
        } catch {
          /* already closed */
        }
        try {
          upstream.close();
        } catch {
          /* already closed */
        }
      };
      client.on("close", closeBoth);
      upstream.on("close", closeBoth);
      client.on("error", closeBoth);
      upstream.on("error", closeBoth);
    });
  };
  app.server.on("upgrade", onUpgrade);

  return {
    origin,
    close: async () => {
      app.server.off("upgrade", onUpgrade);
      wss.close();
      await app.close();
    },
  };
}
