# ADR-0010: How a remote guest joins, without trusting the engine

## Status

Accepted (2026-07-18)

## Context

ADR-0009 established that the engine can run _hosted_ (cloud) so guests on
other networks can join, with the host's desktop app dialing it **outbound**
(no inbound host ports). This ADR settles the part that is easy to get subtly
wrong: **the host must reach a hosted room without ever executing the hosted
engine's code with the host's local privileges.**

The threat model treats the collaboration engine as possibly compromised. In
the packaged app the host window carries `window.clauderooms` — a preload
bridge that can open a folder picker, start the local Claude bridge, and, via
`openRoom`, return the session tokens of **any** remembered room. If the host
window ever loaded the hosted engine's HTML/JS (same-origin, the obvious way to
"open the room"), a malicious engine could call `openRoom` for every stored
room and exfiltrate its tokens, or drive `pickRepo`/`startBridge`. Loading
remote code into the privileged window is therefore off the table.

Guests are different: a plain browser on the hosted origin has no preload and
no local privileges, so it can load the hosted UI directly — the same trust as
any website.

## Decision

1. **The hosted engine is the same `apps/server`, deployed.** It binds
   `CLAUDEROOMS_HOST=0.0.0.0` behind a TLS-terminating proxy (it speaks plain
   HTTP/WS — no built-in TLS), serves the built web client via
   `CLAUDEROOMS_STATIC_DIR`, and sets `CLAUDEROOMS_ALLOWED_ORIGINS` to its own
   public origin. Guests open `https://rooms.example.com/#invite=…`; the web
   client, served from that origin, connects `wss://` same-origin.

2. **The host window only ever loads local, trusted UI.** In hosted mode the
   desktop still loads its window from a loopback origin serving the _bundled_
   web build — never the hosted origin. The hosted engine can send room
   **data** (frames, rendered as inert text — hard rule 5) but never **code**
   into the privileged window.

3. **The desktop main process proxies the room to the hosted engine.** The
   host UI's `/ws` and `/api` stay same-origin with the local loopback; the
   main process forwards them to `wss://rooms.example.com`. The host bridge
   dials `wss://rooms.example.com/bridge` directly (as in ADR-0009). The
   hosted engine's origin allow-list stays tight (only its own origin); no
   loopback origins are ever added to a public engine.

4. **The engine still never receives the repo or credentials.** Exactly as
   local mode: repository reads run in the desktop main process against
   `RepoAccessPolicy`; only Claude request content and answer text cross to the
   engine. A hosted engine is no more trusted than a local one — it sees room
   traffic, nothing on the host's disk.

## Consequences

- Remote guests work as a **deployment**, not an app rewrite: the same engine
  image, the same web build, the same desktop app pointed at a hosted URL.
- The proxy is the one new host-side component. It adds a hop but keeps the
  hosted engine's origin policy tight and the privileged window free of remote
  code.
- TLS is the proxy's job; the engine and the app assume `wss://` to the hosted
  origin. Certificate/e2e verification across a real network is out of scope
  for the local mechanism and is the acceptance gate for the deploy slice.
- A compromised hosted engine can still show bad room content and drop the
  room, but cannot read the host's files, steal other rooms' tokens, or run
  code with host privileges.

## Alternatives considered

- **Host loads the hosted origin directly (same-origin, simplest).** Rejected:
  it runs the engine's JS in the window that holds `window.clauderooms`, so a
  compromised engine could exfiltrate every remembered room's tokens. This is
  the whole reason for the proxy.
- **Host UI on a fixed loopback port, connecting cross-origin to the hosted
  engine (add its loopback origin to the engine's allow-list).** Less code than
  a proxy, but it loosens a _public_ engine's origin policy and leaks the
  desktop's local topology into server config. The proxy keeps both ends tight.
- **Inbound tunnel to a local engine (ngrok-style).** Rejected in ADR-0009:
  opens the host to the network and inverts the trust model.
