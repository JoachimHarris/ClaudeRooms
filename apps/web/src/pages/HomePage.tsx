import { useState } from "react";
import { createRoom, describeApiError } from "../api.js";
import { navigate } from "../router.js";
import { saveSession } from "../session.js";

export function HomePage() {
  const [roomName, setRoomName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createRoom({
        roomName: roomName.trim(),
        displayName: displayName.trim(),
      });
      saveSession(result.room.id, {
        sessionToken: result.sessionToken,
        participantId: result.participant.id,
        inviteToken: result.inviteToken,
        inviteExpiresAt: result.inviteExpiresAt,
      });
      navigate(`/room/${result.room.id}`);
    } catch (err) {
      setError(describeApiError(err));
      setBusy(false);
    }
  }

  return (
    <main className="centered-page">
      <div className="landing">
        <h1>ClaudeRooms</h1>
        <p className="tagline">Multiplayer collaboration for Claude Code.</p>
        <p className="muted small">
          Pre-alpha · local-first · not affiliated with or endorsed by Anthropic
        </p>
        <form onSubmit={onSubmit} className="stack">
          <label>
            Room name
            <input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="e.g. Data model review"
              maxLength={80}
              required
              autoFocus
            />
          </label>
          <label>
            Your name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How others will see you"
              maxLength={80}
              required
            />
          </label>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create room"}
          </button>
        </form>
        <p className="muted small">
          Got an invitation link? Just open it — it takes you straight to the room.
        </p>
      </div>
    </main>
  );
}
