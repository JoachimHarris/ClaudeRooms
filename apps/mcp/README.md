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

## Status

The engine client (`room-client.ts` — auth, read decisions/messages, post) is
tested against a real engine. Wiring it into a live Claude Desktop/Code client
and the optional terminal "pro mode" (session mirror via Claude Code hooks)
are the remaining Milestone 8 work.
