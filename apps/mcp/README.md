# @clauderooms/mcp — ClaudeRooms MCP server

Point Claude Desktop or Claude Code at a ClaudeRooms room so their Claude can
read the room's decisions and messages and post an update (Milestone 8). Not
affiliated with or endorsed by Anthropic.

It joins the room as an ordinary participant over the same WebSocket protocol
the web client uses, authenticating with a **room session token** — so it can
do only what that participant can do, and the engine enforces the same rules.

## Tools

- `list_decisions` — the room's decisions (accepted / rejected / open proposals).
- `list_messages` — recent messages (`limit`, default 50).
- `post_message` — post a message to the room (`content`).

## Configuration

Two environment variables:

| Variable                    | Value                                                        |
| --------------------------- | ------------------------------------------------------------ |
| `CLAUDEROOMS_ENGINE_URL`    | The engine base URL — `http(s)://` or `ws(s)://` (no `/ws`). |
| `CLAUDEROOMS_SESSION_TOKEN` | A room session token (from the desktop app, one room).       |

The token scopes the server to exactly one room and one participant identity —
treat it like a password; anyone with it can act as that participant.

## Wiring it into Claude Desktop / Claude Code

Add an entry to the MCP servers config (Claude Desktop's `mcpServers`, or
`claude mcp add`), pointing at this package via `tsx`:

```json
{
  "mcpServers": {
    "clauderooms": {
      "command": "pnpm",
      "args": ["--filter", "@clauderooms/mcp", "start"],
      "cwd": "/absolute/path/to/ClaudeRooms",
      "env": {
        "CLAUDEROOMS_ENGINE_URL": "https://rooms.example.com",
        "CLAUDEROOMS_SESSION_TOKEN": "<a room session token>"
      }
    }
  }
}
```

For a locally hosted room, use the embedded engine's URL (e.g.
`http://127.0.0.1:3001`).

## Pro mode — mirror a terminal Claude Code session into a room

A power user working in Claude Code in the terminal can mirror what the session
is driving at into a ClaudeRooms room, using Claude Code **hooks**. The runner
(`src/hook.ts`) reads the hook event on stdin and posts the worth-sharing lines
(the human's prompts, and session start/end markers — never tool spam or
Claude's full output). It uses the same two env vars, and **never fails the
terminal session**: any error exits 0 silently.

Configure the hooks in Claude Code settings (`~/.claude/settings.json` or the
project's `.claude/settings.json`):

```json
{
  "env": {
    "CLAUDEROOMS_ENGINE_URL": "https://rooms.example.com",
    "CLAUDEROOMS_SESSION_TOKEN": "<a room session token>"
  },
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "pnpm --filter @clauderooms/mcp mirror" }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "pnpm --filter @clauderooms/mcp mirror" }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "pnpm --filter @clauderooms/mcp mirror" }
        ]
      }
    ]
  }
}
```

## Status

The engine client (`room-client.ts` — auth, read decisions/messages, post) and
the pro-mode hook formatter (`mirror-hook.ts`) are unit-tested (the former
against a real engine). Wiring the MCP server into a live Claude Desktop/Code
client, and a live hook round-trip, are the remaining Milestone 8 verification.
