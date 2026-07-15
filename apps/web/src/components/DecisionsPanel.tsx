import { useEffect, useState } from "react";
import type { DecisionView } from "@clauderooms/shared";
import { LIMITS } from "@clauderooms/shared";

export interface DecisionPrefill {
  statement: string;
  sourceMessageId: string;
}

export function DecisionsPanel({
  decisions,
  isHost,
  disabled,
  prefill,
  onClearPrefill,
  onPropose,
  onResolve,
}: {
  decisions: DecisionView[];
  isHost: boolean;
  disabled: boolean;
  prefill: DecisionPrefill | null;
  onClearPrefill: () => void;
  onPropose: (input: {
    title: string;
    statement: string;
    rationale?: string;
    sourceMessageId?: string;
  }) => void;
  onResolve: (decisionId: string, status: "accepted" | "rejected") => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [rationale, setRationale] = useState("");

  useEffect(() => {
    if (prefill) {
      setOpen(true);
      setStatement(prefill.statement);
    }
  }, [prefill]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !statement.trim()) return;
    onPropose({
      title: title.trim(),
      statement: statement.trim(),
      ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
      ...(prefill ? { sourceMessageId: prefill.sourceMessageId } : {}),
    });
    setTitle("");
    setStatement("");
    setRationale("");
    setOpen(false);
    onClearPrefill();
  }

  const proposed = decisions.filter((d) => d.status === "proposed");
  const resolved = decisions.filter((d) => d.status !== "proposed");

  return (
    <aside className="panel" aria-label="Decisions">
      <h2 className="panel-title">Decisions</h2>

      {proposed.length === 0 && resolved.length === 0 && (
        <p className="muted small">
          No decisions yet. Capture important agreements so they outlive the chat.
        </p>
      )}

      {proposed.map((decision) => (
        <div key={decision.id} className="decision proposed">
          <p className="decision-title">{decision.title}</p>
          <p className="decision-statement">{decision.statement}</p>
          {decision.rationale && <p className="muted small">{decision.rationale}</p>}
          <p className="muted small">status: proposed</p>
          {isHost && !disabled && (
            <p className="decision-actions">
              <button
                className="btn small"
                onClick={() => onResolve(decision.id, "accepted")}
              >
                Accept
              </button>
              <button
                className="btn small subtle"
                onClick={() => onResolve(decision.id, "rejected")}
              >
                Reject
              </button>
            </p>
          )}
          {!isHost && <p className="muted small">Waiting for the host to resolve.</p>}
        </div>
      ))}

      {resolved.map((decision) => (
        <div key={decision.id} className={`decision ${decision.status}`}>
          <p className="decision-title">
            {decision.status === "accepted" ? "✓" : "✕"} {decision.title}
          </p>
          <p className="decision-statement">{decision.statement}</p>
          <p className="muted small">status: {decision.status}</p>
        </div>
      ))}

      {!disabled && (
        <div className="propose-block">
          {!open ? (
            <button className="btn small" onClick={() => setOpen(true)}>
              Propose decision
            </button>
          ) : (
            <form onSubmit={submit} className="stack">
              <label>
                Title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={LIMITS.maxDecisionTitleLength}
                  required
                  autoFocus
                />
              </label>
              <label>
                Statement
                <textarea
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  maxLength={LIMITS.maxDecisionTextLength}
                  rows={3}
                  required
                />
              </label>
              <label>
                Rationale (optional)
                <textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  maxLength={LIMITS.maxDecisionTextLength}
                  rows={2}
                />
              </label>
              <p className="decision-actions">
                <button className="btn small primary" type="submit">
                  Propose
                </button>
                <button
                  className="btn small subtle"
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onClearPrefill();
                  }}
                >
                  Cancel
                </button>
              </p>
            </form>
          )}
        </div>
      )}
    </aside>
  );
}
