import { useEffect, useRef } from "react";
import type { MessageView, ParticipantView } from "@clauderooms/shared";
import type { RoomState } from "../roomState.js";

function authorName(
  message: MessageView,
  participants: Record<string, ParticipantView>,
): string {
  if (message.authorType === "claude") return "Claude";
  if (message.authorType === "system") return "System";
  return message.authorParticipantId
    ? (participants[message.authorParticipantId]?.displayName ?? "Unknown")
    : "Unknown";
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function Timeline({
  state,
  onProposeFromMessage,
}: {
  state: RoomState;
  onProposeFromMessage: (message: MessageView) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamingEntries = Object.entries(state.streaming);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [state.timeline.length, streamingEntries.map(([, text]) => text.length).join()]);

  return (
    <div className="timeline" role="log" aria-label="Conversation">
      {state.timeline.map((item) => {
        if (item.kind === "system") {
          return (
            <p key={item.id} className="system-line">
              {item.text} · {timeOf(item.at)}
            </p>
          );
        }
        const { message } = item;
        const isClaudeRequest = message.messageType === "claude_request";
        const isClaudeResponse = message.messageType === "claude_response";
        return (
          <article
            key={message.id}
            className={`msg ${isClaudeResponse ? "claude" : ""} ${isClaudeRequest ? "claude-request" : ""}`}
          >
            <header className="msg-head">
              <span className="msg-author">
                {authorName(message, state.participants)}
              </span>
              {isClaudeRequest && <span className="chip">→ Ask Claude</span>}
              {isClaudeResponse && <span className="chip claude-chip">Claude</span>}
              <time className="msg-time" dateTime={message.createdAt}>
                {timeOf(message.createdAt)}
              </time>
              {message.messageType === "human" && state.connection === "connected" && (
                <button
                  className="link-btn"
                  onClick={() => onProposeFromMessage(message)}
                  title="Propose this message as a decision"
                >
                  → decision
                </button>
              )}
            </header>
            {/* Rendered as text nodes only — room content is untrusted. */}
            <p className="msg-body">{message.content}</p>
          </article>
        );
      })}
      {streamingEntries.map(([requestId, text]) => (
        <article key={requestId} className="msg claude streaming" aria-live="off">
          <header className="msg-head">
            <span className="msg-author">Claude</span>
            <span className="chip claude-chip">streaming…</span>
          </header>
          <p className="msg-body">
            {text}
            <span className="cursor" aria-hidden="true">
              ▍
            </span>
          </p>
        </article>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
