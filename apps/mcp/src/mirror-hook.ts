// "Pro mode" (Milestone 8): mirror a terminal Claude Code session into a
// ClaudeRooms room via Claude Code hooks. A hook command receives the event as
// JSON on stdin; `formatHookEvent` turns the events worth sharing into a room
// line and ignores the noisy ones (returning null). Kept pure so it is
// unit-testable with no Claude Code or network in the loop; `hook.ts` is the
// thin runner that reads stdin and posts the line.

const MAX_PROMPT = 600;

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_PROMPT ? `${trimmed.slice(0, MAX_PROMPT)}…` : trimmed;
}

/**
 * Maps one Claude Code hook event to a room message, or null when the event is
 * not worth mirroring. We share the human's prompts (what the terminal session
 * is driving at) and start/end markers — never tool spam or Claude's full
 * output, which would flood the room.
 */
export function formatHookEvent(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return null;
  const record = event as Record<string, unknown>;
  const name = record.hook_event_name;

  switch (name) {
    case "UserPromptSubmit": {
      const prompt = record.prompt;
      if (typeof prompt !== "string" || prompt.trim().length === 0) return null;
      return `🧑 terminal · ${truncate(prompt)}`;
    }
    case "SessionStart":
      return "▶️ terminal · a Claude Code session started in the repository";
    case "SessionEnd":
      return "⏹️ terminal · the Claude Code session ended";
    default:
      return null;
  }
}
