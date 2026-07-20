import { useState } from "react";
import { LIMITS } from "@clauderooms/shared";

export type ComposerMode = "room" | "claude" | "claude-repo" | "propose-write";

// A one-line, plain-language explanation of the selected mode, shown under the
// composer so the modes explain themselves in place (no jargon to memorise).
const MODE_HINT: Record<ComposerMode, string> = {
  room: "A normal message to the room. Claude is not involved.",
  claude: "Claude answers here, but cannot see your repository — discussion only.",
  "claude-repo":
    "Claude reads repository files — the host must approve the request first.",
  "propose-write":
    "Suggest a file change. The host reviews the exact path and contents and approves before anything is written.",
};

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (mode: ComposerMode, content: string, path?: string) => void;
}) {
  const [mode, setMode] = useState<ComposerMode>("room");
  const [content, setContent] = useState("");
  const [writePath, setWritePath] = useState("");

  const isWrite = mode === "propose-write";

  function submit() {
    if (disabled) return;
    if (isWrite) {
      const path = writePath.trim();
      // A write with no content is still valid (an empty file); the path is not.
      if (!path) return;
      onSend(mode, content, path);
      setContent("");
      setWritePath("");
      return;
    }
    const trimmed = content.trim();
    if (!trimmed) return;
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
        <option value="room">Message the room</option>
        <option value="claude">Ask Claude — chat only</option>
        <option value="claude-repo">Ask Claude — read the repo</option>
        <option value="propose-write">Propose a file change</option>
      </select>
      {isWrite && (
        <input
          id="composer-write-path"
          className="write-path"
          value={writePath}
          maxLength={1024}
          placeholder="Repo-relative path, e.g. src/notes.md"
          aria-label="File path to write"
          onChange={(e) => setWritePath(e.target.value)}
          disabled={disabled}
        />
      )}
      <label className="visually-hidden" htmlFor="composer-input">
        {isWrite
          ? "File contents"
          : mode.startsWith("claude")
            ? "Ask Claude"
            : "Message the room"}
      </label>
      <textarea
        id="composer-input"
        value={content}
        maxLength={isWrite ? 1_000_000 : LIMITS.maxMessageLength}
        placeholder={
          isWrite
            ? "File contents to write — the host reviews this before it lands…"
            : mode === "claude"
              ? "Ask Claude explicitly — discussion only, no repository access…"
              : mode === "claude-repo"
                ? "Ask Claude to look at the repository — the host must allow it first…"
                : "Write a message to the room…"
        }
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !isWrite) {
            e.preventDefault();
            submit();
          }
        }}
        rows={isWrite ? 4 : 2}
        disabled={disabled}
      />
      <button
        className={`btn ${mode === "room" ? "primary" : "claude-btn"}`}
        type="submit"
        disabled={
          disabled ||
          (isWrite ? writePath.trim().length === 0 : content.trim().length === 0)
        }
      >
        {isWrite
          ? "Propose write"
          : mode === "claude-repo"
            ? "Request"
            : mode === "claude"
              ? "Ask Claude"
              : "Send"}
      </button>
      {/* Self-explaining: what the selected mode does, in plain language. */}
      <p className="composer-hint">{MODE_HINT[mode]}</p>
    </form>
  );
}
