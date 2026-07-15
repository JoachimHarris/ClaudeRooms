# Claude integration options

Status: researched 2026-07-15 against official documentation
(code.claude.com/docs and platform.claude.com/docs). This document exists so we
do not build the bridge on guesses or stale blog posts.

## The question

ClaudeRooms needs a local bridge that can:

1. Submit explicit requests to Claude with repository context.
2. Stream Claude's output back to a shared room.
3. Observe and intercept permission-relevant actions (file edits, commands)
   so the host can approve or reject them.
4. Keep credentials on the host machine.
5. Eventually be installable as part of the normal Claude Code workflow.

## Options evaluated

### Option A — Claude Agent SDK for TypeScript (`@anthropic-ai/claude-agent-sdk`)

The Claude Code harness packaged as a library. Verified capabilities:

| Requirement                  | Verdict | Mechanism                                                                                                                                                                                                                       |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submit requests              | ✅      | `query({ prompt, options })` returns an async generator of `SDKMessage`                                                                                                                                                         |
| Bidirectional / multi-turn   | ✅      | Streaming input mode: pass an `AsyncIterable<SDKUserMessage>` as `prompt`; `Query.streamInput()`, `interrupt()`                                                                                                                 |
| Streaming output             | ✅      | Message stream; `includePartialMessages: true` for token-level partial events                                                                                                                                                   |
| Permission interception      | ✅      | `canUseTool(toolName, input, opts) => PermissionResult` callback, `permissionMode` (`default`, `plan`, `dontAsk`, …); `PreToolUse` hooks gate _every_ tool call (canUseTool is only invoked when the flow resolves to a prompt) |
| Session identifiers / resume | ✅      | `resume`, `forkSession`, `resumeSessionAt`, `sessionId`, `persistSession` options                                                                                                                                               |
| MCP                          | ✅      | `mcpServers` config incl. in-process `McpSdkServerConfig`; runtime `setMcpServers` / `toggleMcpServer`                                                                                                                          |
| Credentials stay local       | ✅      | No `apiKey` option — auth flows through the bundled Claude Code CLI binary and the user's existing Claude Code login (or env credentials). Nothing is sent to our collaboration server.                                         |
| Stability                    | Good    | Officially documented and versioned; it _is_ the Claude Code harness, so tool behavior matches what hosts already trust                                                                                                         |

What it cannot do: it cannot attach to or observe an _already running
interactive_ Claude Code terminal session. A ClaudeRooms request runs in its
own SDK-managed session (which can `resume` a prior session ID, so continuity
across requests is supported).

### Option B — Claude Code plugin (skills + hooks + MCP)

Verified: plugins are directories with `.claude-plugin/plugin.json`, plus
`skills/`, `agents/`, `hooks/hooks.json`, `.mcp.json`; distributed via
marketplaces or `--plugin-dir`; skills are namespaced (`/clauderooms:start`).

A plugin **cannot** by itself host a collaboration server or push a running
interactive session's transcript elsewhere. It is the right vehicle for the
_user experience_ (start/share/end a room from inside Claude Code, hooks that
notify the room of actions) — not for the core transport. Deferred to
Milestone 6, layered on top of Option A.

### Option C — Raw Messages API (`@anthropic-ai/sdk`)

Full control, but we would have to reimplement the entire tool harness
(file edit, bash, permissions, repo context) that the Agent SDK already
provides with host-trusted semantics. Rejected for MVP; the `ClaudeAdapter`
interface keeps the door open.

## Recommendation

1. **Milestones 0–2:** no Claude dependency at all. A deterministic
   `FakeClaudeAdapter` implements the `ClaudeAdapter` interface so the entire
   collaboration loop (rooms, invitations, messaging, decisions, approvals)
   is proven first and remains testable without paid API calls.
2. **Milestone 3+:** implement `AgentSdkClaudeAdapter` on
   `@anthropic-ai/claude-agent-sdk`, running inside the **local bridge** on
   the host machine. `canUseTool` + `PreToolUse` hooks map directly onto the
   ClaudeRooms action-approval model; `permissionMode: "plan"` maps onto
   discussion-only requests. Credentials never leave the host.
3. **Milestone 6:** ship a Claude Code plugin (skill `/clauderooms:start`
   etc.) that shells out to the ClaudeRooms CLI/bridge, following current
   plugin packaging conventions.

Trade-off accepted: the SDK runs its own session rather than mirroring the
host's interactive terminal session. For the product promise ("invite someone
into a room connected to your Claude Code workflow") this is sufficient and
substantially safer, because everything Claude does for the room passes
through the bridge's authorization layer.
