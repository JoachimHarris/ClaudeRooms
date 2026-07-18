# Deploying the hosted engine (remote guests)

For remote guests, the ClaudeRooms engine (`apps/server`) runs on a small
hosted instance and serves the web client; the host's desktop app connects to
it outbound (ADR-0009, ADR-0010). This is the same engine that runs embedded
in the packaged app — only the configuration differs.

## What it is

One process that serves the web client over HTTP and speaks the room/bridge
protocol over WebSocket. It has **no built-in TLS** and must sit behind a
TLS-terminating reverse proxy (Caddy, nginx, a platform router, …). Guests
reach `https://rooms.example.com`; the proxy forwards to the engine's plain
HTTP/WS port.

## Configuration (environment)

| Variable                      | Purpose                                           | Example                     |
| ----------------------------- | ------------------------------------------------- | --------------------------- |
| `CLAUDEROOMS_HOST`            | Bind address. `0.0.0.0` to accept the proxy.      | `0.0.0.0`                   |
| `CLAUDEROOMS_PORT`            | Port the engine listens on.                       | `3001`                      |
| `CLAUDEROOMS_STATIC_DIR`      | Built web client (`apps/web/dist`) to serve.      | `/app/web`                  |
| `CLAUDEROOMS_ALLOWED_ORIGINS` | The public origin(s) allowed to open a WebSocket. | `https://rooms.example.com` |
| `CLAUDEROOMS_DB`              | SQLite file path (persistent volume).             | `/data/clauderooms.db`      |

Loopback and `localhost` binds start silently; any other bind logs a warning
that a TLS proxy must be in front.

## Build and run

```sh
pnpm --filter @clauderooms/web build          # produces apps/web/dist
pnpm --filter @clauderooms/server build        # typecheck

CLAUDEROOMS_HOST=0.0.0.0 \
CLAUDEROOMS_PORT=3001 \
CLAUDEROOMS_STATIC_DIR="$(pwd)/apps/web/dist" \
CLAUDEROOMS_ALLOWED_ORIGINS="https://rooms.example.com" \
CLAUDEROOMS_DB=/data/clauderooms.db \
  pnpm --filter @clauderooms/server start
```

Put TLS in front (example, Caddy):

```
rooms.example.com {
  reverse_proxy 127.0.0.1:3001
}
```

## Security notes

- The engine is treated as **possibly compromised** (threat model). It sees
  room traffic only — never the host's repository, filesystem paths, or Claude
  credentials, which stay in the host's desktop process (ADR-0007, ADR-0010).
- Keep `CLAUDEROOMS_ALLOWED_ORIGINS` to the public origin only. The host does
  **not** add its loopback origin here — it reaches the engine through the
  desktop app's proxy, keeping this allow-list tight (ADR-0010).
- Session and invitation tokens are the primary auth; the origin check is
  defense-in-depth. TLS is mandatory for anything off-host.

## Status

The hosted engine (serving the web client + hosting rooms + accepting the
bridge) runs from this configuration today, and the desktop app's hosted mode —
`CLAUDEROOMS_ENGINE_URL` puts it behind a loopback proxy that forwards room
data to this engine (ADR-0010) — is implemented and verified locally against a
real hosted engine. The only remaining work is operational: a real TLS-fronted
deployment on a public host and a guest join over an actual network.
