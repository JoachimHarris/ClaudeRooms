import type { ParticipantView } from "@clauderooms/shared";
import type { ClaudeStatus } from "../roomState.js";

export function ParticipantsList({
  participants,
  selfId,
  claudeStatus,
}: {
  participants: ParticipantView[];
  selfId: string | null;
  claudeStatus: ClaudeStatus;
}) {
  return (
    <nav className="panel" aria-label="Participants">
      <h2 className="panel-title">Participants</h2>
      <ul className="participant-list">
        {participants.map((participant) => (
          <li key={participant.id}>
            <span
              className={`presence-dot ${participant.connected ? "on" : "off"}`}
              aria-hidden="true"
            />
            <span className="participant-name">
              {participant.displayName}
              {participant.id === selfId ? " (you)" : ""}
            </span>
            <span className={`role-badge ${participant.role}`}>{participant.role}</span>
          </li>
        ))}
        <li>
          <span
            className={`presence-dot ${claudeStatus === "ready" ? "idle" : "on"}`}
            aria-hidden="true"
          />
          <span className="participant-name">Claude</span>
          <span className="role-badge claude">
            {claudeStatus === "ready"
              ? "ready"
              : claudeStatus === "thinking"
                ? "thinking…"
                : "responding…"}
          </span>
        </li>
      </ul>
    </nav>
  );
}
