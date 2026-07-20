import { useState } from "react";
import { createRoom, describeApiError } from "../api.js";
import { navigate } from "../router.js";
import { saveSession } from "../session.js";
import { openHelp } from "../App.js";

interface PickedRepo {
  repositoryName: string;
  branchName: string | null;
}

/**
 * Inside ClaudeRooms.app this is the host's "start a session" screen.
 * In a plain browser there is nothing to host — guests arrive via
 * invitation links, so the page only explains that (ADR-0007).
 */
export function HomePage() {
  const desktop = window.clauderooms;
  return desktop ? <HostHome /> : <GuestLanding />;
}

function HostHome() {
  const [displayName, setDisplayName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [repo, setRepo] = useState<PickedRepo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickRepo() {
    setError(null);
    const picked = await window.clauderooms?.pickRepo();
    if (picked) {
      setRepo(picked);
      // The repo name is the natural default room name; stays editable.
      setRoomName((current) => (current.trim() ? current : picked.repositoryName));
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createRoom({
        roomName: roomName.trim(),
        displayName: displayName.trim(),
        ...(repo ? { repositoryName: repo.repositoryName } : {}),
        ...(repo?.branchName ? { branchName: repo.branchName } : {}),
      });
      saveSession(result.room.id, {
        sessionToken: result.sessionToken,
        participantId: result.participant.id,
        inviteToken: result.inviteToken,
        inviteExpiresAt: result.inviteExpiresAt,
      });
      // Remember the room so it survives an app restart (ADR-0008). Not
      // fatal if the OS cannot encrypt at rest — the room simply stays
      // session-scoped, which is the pre-Milestone-4 behaviour.
      await window.clauderooms?.rememberRoom({
        roomId: result.room.id,
        roomName: result.room.name,
        repositoryName: repo?.repositoryName ?? null,
        branchName: repo?.branchName ?? null,
        displayName: displayName.trim(),
        participantId: result.participant.id,
        sessionToken: result.sessionToken,
        inviteToken: result.inviteToken,
        inviteExpiresAt: result.inviteExpiresAt,
      });
      // Hand the token to the main process so it can run Claude locally for
      // this room. Failure here is not fatal: the room still works, Claude
      // just falls back to the built-in fake adapter.
      await window.clauderooms?.startBridge({
        roomId: result.room.id,
        sessionToken: result.sessionToken,
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
        <div className="landing-head">
          <h1>Start a session</h1>
          <button
            className="btn small subtle"
            type="button"
            onClick={openHelp}
            title="How ClaudeRooms works"
          >
            ? Help
          </button>
        </div>
        <p className="muted small">
          Pick the repository you are working on, then invite your collaborator.
        </p>
        <div className="stack" style={{ marginTop: "16px" }}>
          <div className="repo-picker">
            {repo ? (
              <p className="repo-selected">
                <span className="chip">
                  {repo.repositoryName}
                  {repo.branchName ? ` · ${repo.branchName}` : ""}
                </span>
                <button className="link-btn" type="button" onClick={pickRepo}>
                  change
                </button>
              </p>
            ) : (
              <button className="btn" type="button" onClick={pickRepo}>
                Choose repository folder…
              </button>
            )}
          </div>
          <form onSubmit={onSubmit} className="stack">
            <label>
              Room name
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g. Data model review"
                maxLength={80}
                required
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
        </div>
      </div>
    </main>
  );
}

function GuestLanding() {
  return (
    <main className="centered-page">
      <div className="landing">
        <h1>ClaudeRooms</h1>
        <p className="tagline">Multiplayer collaboration for Claude Code.</p>
        <p className="muted small">
          Pre-alpha · local-first · not affiliated with or endorsed by Anthropic
        </p>
        <p style={{ marginTop: "16px" }}>
          <strong>Got an invitation link?</strong> Just open it — it takes you straight to
          the room in this browser.
        </p>
        <p className="muted">
          Want to host a session around your own repository? That happens in the
          ClaudeRooms desktop app — see the{" "}
          <a href="https://github.com/JoachimHarris/ClaudeRooms#readme">
            README on GitHub
          </a>{" "}
          to get started.
        </p>
      </div>
    </main>
  );
}
