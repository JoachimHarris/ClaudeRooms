import { useState } from "react";
import { LIMITS } from "@clauderooms/shared";

export type ComposerMode = "room" | "claude" | "claude-repo";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (mode: ComposerMode, content: string) => void;
}) {
  const [mode, setMode] = useState<ComposerMode>("room");
  const [content, setContent] = useState("");

  function submit() {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    onSend(mode, trimmed);
    setContent("");
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="visually-hidden" htmlFor="composer-mode">
        Message mode
      </label>
      <select
        id="composer-mode"
        className={`mode-select ${mode.startsWith("claude") ? "claude" : "room"}`}
        value={mode}
        onChange={(e) => setMode(e.target.value as ComposerMode)}
        disabled={disabled}
      >
        <option value="room">Message room</option>
        <option value="claude">Ask Claude</option>
        <option value="claude-repo">Ask Claude: use repository</option>
      </select>
      <label className="visually-hidden" htmlFor="composer-input">
        {mode.startsWith("claude") ? "Ask Claude" : "Message the room"}
      </label>
      <textarea
        id="composer-input"
        value={content}
        maxLength={LIMITS.maxMessageLength}
        placeholder={
          mode === "claude"
            ? "Ask Claude explicitly — discussion only, no repository access…"
            : mode === "claude-repo"
              ? "Ask Claude to look at the repository — the host must allow it first…"
              : "Write a message to the room…"
        }
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        disabled={disabled}
      />
      <button
        className={`btn ${mode.startsWith("claude") ? "claude-btn" : "primary"}`}
        type="submit"
        disabled={disabled || content.trim().length === 0}
      >
        {mode === "claude-repo" ? "Request" : mode === "claude" ? "Ask Claude" : "Send"}
      </button>
    </form>
  );
}
