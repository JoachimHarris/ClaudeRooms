# ADR-0007: Desktop-first host experience

## Status

Accepted (2026-07-15)

## Context

Milestone 1 delivered the collaboration loop, but the product experience read
as "yet another chat in a browser tab": the host had to open localhost, fill
in a form, and the room lived apart from where the work happens. The founder's
verdict: the product must be integrated with the work, and the terminal is too
high a barrier even for many developers. Anthropic's own apps (Claude
Desktop / Claude Code) expose no third-party UI surface, so embedding
ClaudeRooms inside them is not possible — the only integration they offer is
MCP (tools, not UI).

## Decision

1. **The host experience is a desktop app** (`apps/desktop`, Electron). The
   host opens ClaudeRooms.app, picks a repository folder with a native
   dialog, and hosts from there. Claude (from Milestone 3, via the Claude
   Agent SDK) works on that repository _from within the app_ — the terminal
   is never required.
2. **The browser is demoted to the guest surface.** Invitation links open in
   a plain browser with zero install; the standalone "create a room on
   localhost" browser flow is removed as a product surface.
3. **Electron over Tauri**: the entire engine (Fastify, SQLite, Agent SDK) is
   Node, so Electron reuses it directly; Tauri would need a Node sidecar
   anyway.
4. **The engine stays a separate concern.** The collaboration server is
   consumed as a library/child process by the app (dev: shared `pnpm dev`
   processes; packaged mode with an engine child process + `staticDir` web
   bundle lands in Milestone 4). This preserves the trust-boundary
   architecture and keeps a future cloud relay possible without redesign.
5. **Timeline UI principle ("hybrid")**: one shared track for humans and
   Claude _results_; Claude's detailed work (tool steps, diffs) renders as
   collapsible work cards inside that track, with a side panel summarizing
   changes and approvals. No hard two-panel split of conversation vs. work.
6. **Path hygiene is enforced, not assumed**: the app sends only display
   metadata (repo name + branch) to the server; the absolute path never
   leaves the Electron main process. The protocol validates that repository
   metadata cannot carry path separators or traversal.

## Consequences

- The "no Electron desktop application" entry leaves the non-goals list
  (scope change approved by the founder).
- The Claude Code plugin / session-mirror idea is deprioritized to a later
  "pro mode" for terminal users; MCP integration with Claude Desktop/Code
  becomes a later additive milestone.
- Packaging (signing, notarization, sqlite ABI for Electron) is explicitly
  Milestone 4 work; until then the app runs from source via `pnpm dev`.
- Electron security posture is part of the threat model: contextIsolation on,
  sandbox on, nodeIntegration off, single narrow preload bridge, external
  links only via the system browser.

## Alternatives considered

- **Panel inside Claude Desktop/Code** — no such extension point exists.
- **Terminal plugin as the primary integration** (session mirror via hooks) —
  technically feasible, but keeps the terminal as the center of gravity,
  which contradicts the product thesis.
- **Tauri** — lighter binaries, but a Rust shell around an all-Node engine
  adds a language boundary without removing any work.
