# ADR-0009: Packaging the host app, and how remote guests will join

## Status

Accepted (2026-07-18)

## Context

Through Milestone 5 the host runs from source: `pnpm dev` starts three
processes — the Vite dev server (renderer), the collaboration engine
(`apps/server`, a separate Node process), and Electron (the host shell, which
connects to the engine over `ws://localhost:3001/bridge` and loads the
renderer from `http://localhost:5173`). A packaged binary today deliberately
refuses to run (`app.isPackaged` → error dialog).

Milestone 6 makes ClaudeRooms a thing you download and run, and lets a guest
on another network join. Two questions need deciding on the record:

1. **Where does the engine run in a packaged app, and how does the native
   SQLite module (`better-sqlite3`) load under Electron's ABI?**
2. **How does a remote guest reach a room when the host is a desktop app
   behind NAT with no inbound ports?**

## Decision

### The engine is one component, deployed in one of two places

The engine is already fully decoupled: the renderer talks to it over
WebSocket, and the host shell talks to it over a separate `/bridge`
WebSocket. Nothing about the engine assumes it is local. We lean into that:

- **Embedded (loopback)** — for solo and same-machine use, the packaged app
  runs the engine **in the Electron main process** and serves the built web
  client from it. This milestone.
- **Hosted (cloud)** — for remote guests, the same engine image runs on a
  small hosted instance; the host's desktop app connects its bridge
  **outbound** to it exactly as it connects to loopback today, and guests open
  the hosted URL. A later slice.

The desktop app is, in both cases, just a **host bridge + local Claude
runner**. It never accepts inbound connections. This preserves the threat
model's "the collaboration server may be compromised" stance (ADR, threat
model): the host's repository and credentials never live on the engine, so a
hosted engine is no more trusted than a local one.

### Packaged runtime (embedded engine)

1. **In-process, not a child process.** The main process already hosts the
   Agent SDK; running Fastify + the room store there too avoids a second IPC
   boundary and a second lifecycle to manage. Crash-isolation via a
   `utilityProcess` child is a known future option, not needed for the MVP.
2. **Loopback, OS-assigned port.** The engine binds `127.0.0.1:0`; the actual
   port is read back and used both for the window URL and the bridge URL. No
   fixed port to clash with, nothing listening off-host.
3. **The engine serves the client.** `buildServer({ staticDir })` already
   serves the built `apps/web` bundle with an SPA fallback. The window loads
   from `http://127.0.0.1:<port>`, so the renderer's WebSocket is same-origin
   and the existing navigation lock keys off that one origin.
4. **`better-sqlite3` is rebuilt for Electron at packaging time.** The native
   module's ABI must match the runtime. Dev and tests keep the system-Node
   build (they run the engine under Node via `tsx`/`vitest`); `electron-builder`
   rebuilds it for Electron's ABI **only in the packaged output**. The two
   builds never share a binary, which is why this is a packaging step and not
   a `pnpm install` step.

### Remote guests (deferred to a later slice)

A hosted engine reachable over TLS, with the host bridge dialing outbound to
it and invitation links pointing at the hosted origin. No inbound host ports,
no tunnel on the host. Scoped and built after the embedded package works.

## Consequences

- A downloaded app can host a solo/same-machine room with no dev servers and
  no terminal — the desktop-first thesis, delivered.
- Dev keeps its three-process setup unchanged; only the packaged path embeds
  the engine. The `app.isPackaged` guard is replaced by the real runtime.
- Packaging must run a native rebuild; CI/build docs gain that step, and the
  build is now platform-specific (macOS first).
- Because the engine can be embedded or hosted with no app change, remote
  guests become a deployment question, not a rewrite.
- `better-sqlite3` being ABI-specific means "run the packaged main against
  system Node" will not work — the packaged binary is the only place the
  Electron-ABI build exists. Local verification of the serving path therefore
  runs under system Node against `staticDir`, and the Electron-ABI rebuild is
  proven in the packaged build itself.

## Alternatives considered

- **Engine as a child process (`utilityProcess`/spawned Node).** More
  isolation, but a second lifecycle, a second place for the ABI problem, and
  IPC plumbing — for no MVP benefit. Revisit if engine crashes start taking
  the window down.
- **Load the renderer from `file://` and keep the engine on a fixed port.**
  Splits the app across two origins (file + ws://localhost:3001), complicating
  the navigation lock and CSP, and the fixed port can clash. Serving the
  client from the engine keeps everything one origin.
- **Ship a bundled Node runtime to run the engine.** Heavier than rebuilding
  one native module for the Electron runtime we already ship.
- **Remote guests via an inbound tunnel on the host (ngrok-style).** Opens the
  host to the network and inverts the trust model. The hosted-engine +
  outbound-bridge design keeps the host closed.
