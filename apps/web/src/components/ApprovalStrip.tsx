import type { ClaudeRequestView, ParticipantView } from "@clauderooms/shared";

// Approvals are never buried in the chat log (docs/security/threat-model.md:
// "collaborator tricking host into approving misleading actions"). This sits
// directly above the composer — where the host is already looking — and
// states plainly who asked, what for, and in their own words.

const MODE_LABEL: Record<string, string> = {
  repository_read: "read this repository",
  repository_write: "write to this repository",
};

function requesterName(
  request: ClaudeRequestView,
  participants: Record<string, ParticipantView>,
): string {
  return participants[request.createdByParticipantId]?.displayName ?? "Someone";
}

export function ApprovalStrip({
  pending,
  participants,
  isHost,
  onApprove,
  onReject,
}: {
  pending: ClaudeRequestView[];
  participants: Record<string, ParticipantView>;
  isHost: boolean;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
}) {
  if (pending.length === 0) return null;

  return (
    <div className="approvals" role="region" aria-label="Approvals">
      {pending.map((request) => (
        <div key={request.id} className="approval" role="alert">
          <div className="approval-body">
            <p className="approval-title">
              <strong>{requesterName(request, participants)}</strong> wants Claude to{" "}
              <strong>{MODE_LABEL[request.mode] ?? request.mode}</strong>
            </p>
            {/* The request verbatim: the host approves what was actually
                asked, not a paraphrase of it. */}
            <p className="approval-quote">{request.content}</p>
            {/* For a write, the host reviews the EXACT path and bytes that will
                land before approving — never a paraphrase (M7, ADR-0011). */}
            {request.write && (
              <div className="approval-write">
                <p className="approval-write-path">{request.write.path}</p>
                <pre className="approval-write-content">{request.write.content}</pre>
              </div>
            )}
            <p className="muted small">
              {request.write
                ? "Nothing is written until you approve, and this approves exactly this one file."
                : "Claude has no repository access until you allow it, and this applies to this one request only."}
            </p>
          </div>
          {isHost ? (
            <p className="approval-actions">
              <button className="btn small primary" onClick={() => onApprove(request.id)}>
                Allow once
              </button>
              <button className="btn small subtle" onClick={() => onReject(request.id)}>
                Decline
              </button>
            </p>
          ) : (
            <p className="muted small approval-actions">Waiting for the host…</p>
          )}
        </div>
      ))}
    </div>
  );
}
