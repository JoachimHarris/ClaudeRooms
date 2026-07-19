import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RoomClient } from "./room-client.js";

// The ClaudeRooms MCP server (Milestone 8): the host points Claude Desktop or
// Claude Code at this, configured with a room's engine URL + session token, so
// their Claude can read the room's decisions and messages and post an update.
// All room logic lives in RoomClient (tested); this file is only MCP glue.

const engineUrl = process.env.CLAUDEROOMS_ENGINE_URL;
const token = process.env.CLAUDEROOMS_SESSION_TOKEN;
if (!engineUrl || !token) {
  console.error(
    "ClaudeRooms MCP: set CLAUDEROOMS_ENGINE_URL (http(s):// or ws(s):// engine base) and CLAUDEROOMS_SESSION_TOKEN.",
  );
  process.exit(1);
}

const room = await RoomClient.connect({
  wsUrl: engineUrl.replace(/^http/, "ws"),
  token,
});

const server = new McpServer({ name: "clauderooms", version: "0.1.0" });

server.registerTool(
  "list_decisions",
  {
    description: `Decisions recorded in the ClaudeRooms room "${room.name}" (accepted, rejected, or open proposals).`,
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          room.listDecisions().map((d) => ({
            title: d.title,
            statement: d.statement,
            status: d.status,
            rationale: d.rationale,
          })),
          null,
          2,
        ),
      },
    ],
  }),
);

server.registerTool(
  "list_messages",
  {
    description: `Recent messages in the ClaudeRooms room "${room.name}".`,
    inputSchema: { limit: z.number().int().min(1).max(200).optional() },
  },
  async ({ limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          room.listMessages(limit).map((m) => ({
            author: m.authorType,
            content: m.content,
            at: m.createdAt,
          })),
          null,
          2,
        ),
      },
    ],
  }),
);

server.registerTool(
  "post_message",
  {
    description: `Post a message to the ClaudeRooms room "${room.name}".`,
    inputSchema: { content: z.string().min(1).max(4000) },
  },
  async ({ content }) => {
    room.postMessage(content);
    return { content: [{ type: "text", text: "Posted to the room." }] };
  },
);

await server.connect(new StdioServerTransport());
