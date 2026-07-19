import { formatHookEvent } from "./mirror-hook.js";
import { RoomClient } from "./room-client.js";

// The Claude Code hook runner for pro mode (Milestone 8). Claude Code invokes
// this on a hook event, passing the event JSON on stdin; we mirror the
// worth-sharing ones into a ClaudeRooms room. It exits 0 no matter what — a
// mirror failure must never break the user's terminal session.

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const engineUrl = process.env.CLAUDEROOMS_ENGINE_URL;
  const token = process.env.CLAUDEROOMS_SESSION_TOKEN;
  if (!engineUrl || !token) return; // pro mode not configured — do nothing

  let event: unknown;
  try {
    event = JSON.parse(await readStdin());
  } catch {
    return;
  }

  const line = formatHookEvent(event);
  if (!line) return;

  const room = await RoomClient.connect({
    wsUrl: engineUrl.replace(/^http/, "ws"),
    token,
    timeoutMs: 5000,
  });
  room.postMessage(line);
  // Give the frame a moment to flush before the process exits.
  await new Promise((resolve) => setTimeout(resolve, 200));
  room.close();
}

main()
  .catch(() => {
    /* never break the terminal session over a mirror failure */
  })
  .finally(() => process.exit(0));
