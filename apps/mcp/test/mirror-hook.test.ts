import { describe, expect, it } from "vitest";
import { formatHookEvent } from "../src/mirror-hook.js";

// Pro mode's formatter (Milestone 8): which Claude Code hook events become a
// room line, and which are dropped as noise.

describe("formatHookEvent", () => {
  it("mirrors a user prompt", () => {
    const line = formatHookEvent({
      hook_event_name: "UserPromptSubmit",
      prompt: "Refactor the auth module",
    });
    expect(line).toBe("🧑 terminal · Refactor the auth module");
  });

  it("truncates a very long prompt", () => {
    const line = formatHookEvent({
      hook_event_name: "UserPromptSubmit",
      prompt: "x".repeat(2000),
    });
    expect(line).not.toBeNull();
    expect(line!.length).toBeLessThan(700);
    expect(line!.endsWith("…")).toBe(true);
  });

  it("marks session start and end", () => {
    expect(formatHookEvent({ hook_event_name: "SessionStart" })).toContain("started");
    expect(formatHookEvent({ hook_event_name: "SessionEnd" })).toContain("ended");
  });

  it("drops noisy or irrelevant events", () => {
    expect(
      formatHookEvent({ hook_event_name: "PostToolUse", tool_name: "Bash" }),
    ).toBeNull();
    expect(formatHookEvent({ hook_event_name: "Stop" })).toBeNull();
    expect(
      formatHookEvent({ hook_event_name: "UserPromptSubmit", prompt: "  " }),
    ).toBeNull();
  });

  it("is defensive about malformed input", () => {
    expect(formatHookEvent(null)).toBeNull();
    expect(formatHookEvent("not an object")).toBeNull();
    expect(formatHookEvent({})).toBeNull();
  });
});
