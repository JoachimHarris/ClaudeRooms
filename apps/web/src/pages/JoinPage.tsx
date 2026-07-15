import { useMemo, useState } from "react";
import { describeApiError, joinRoom } from "../api.js";
import { saveSession } from "../session.js";

export function JoinPage({ roomId }: { roomId: string }) {
  // The invitation token travels in the URL fragment so it never appears in
  // server logs. Read it once; it is cleared from the URL after joining.
  const inviteToken = useMemo(() => location.hash.replace(/^#/, ""), []);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await joinRoom({
        roomId,
        inviteToken,
        displayName: displayName.trim(),
      });
      saveSession(result.room.id, {
        sessionToken: result.sessionToken,
        participantId: result.participant.id,
      });
      history.replaceState(null, "", `/room/${result.room.id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      setError(describeApiError(err));
      setBusy(false);
    }
  }

  if (!inviteToken) {
    return (
      <main className="centered-page">
        <div className="landing">
          <h1>Invitation link incomplete</h1>
          <p className="muted">
            This link is missing its invitation token (the part after <code>#</code>). Ask
            the host to copy the full invitation link again.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="centered-page">
      <div className="landing">
        <h1>Join room</h1>
        <p className="muted">You have been invited to a ClaudeRooms session.</p>
        <form onSubmit={onSubmit} className="stack">
          <label>
            Your name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How others will see you"
              maxLength={80}
              required
              autoFocus
            />
          </label>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Joining…" : "Join room"}
          </button>
        </form>
      </div>
    </main>
  );
}
