import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MessageView } from "@clauderooms/shared";
import { loadSession } from "../session.js";
import { RoomConnection } from "../ws-client.js";
import { initialRoomState, roomReducer } from "../roomState.js";
import { navigate } from "../router.js";
import { ParticipantsList } from "../components/ParticipantsList.js";
import { Timeline } from "../components/Timeline.js";
import { Composer, type ComposerMode } from "../components/Composer.js";
import { DecisionsPanel, type DecisionPrefill } from "../components/DecisionsPanel.js";

function connectionLabel(connection: string): string {
  switch (connection) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "ended":
      return "Room ended";
    default:
      return "Disconnected";
  }
}

export function RoomPage({ roomId }: { roomId: string }) {
  const session = useMemo(() => loadSession(roomId), [roomId]);
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const [prefill, setPrefill] = useState<DecisionPrefill | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const connectionRef = useRef<RoomConnection | null>(null);
  const sequenceRef = useRef(0);
  sequenceRef.current = state.lastSequence;

  useEffect(() => {
    if (!session) return;
    const connection = new RoomConnection({
      token: session.sessionToken,
      getSinceSequence: () => sequenceRef.current,
      onFrame: (frame) => dispatch({ type: "frame", frame }),
      onStatus: (status) => dispatch({ type: "status", status }),
    });
    connectionRef.current = connection;
    connection.start();
    return () => connection.stop();
  }, [roomId, session]);

  if (!session) {
    return (
      <main className="centered-page">
        <div className="landing">
          <h1>No access to this room</h1>
          <p className="muted">
            This browser has no session for this room. Open your invitation link again, or
            create a new room.
          </p>
          <button className="btn" onClick={() => navigate("/")}>
            Back to start
          </button>
        </div>
      </main>
    );
  }

  const isHost = state.self?.role === "host";
  const roomOpen = state.room?.status === "open" && state.connection === "connected";
  const participants = Object.values(state.participants).sort((a, b) =>
    a.joinedAt.localeCompare(b.joinedAt),
  );

  // Frames must never be lost silently: if the socket is down, say so.
  function sendOrWarn(frame: Record<string, unknown>) {
    const sent = connectionRef.current?.send(frame) ?? false;
    if (!sent) {
      dispatch({
        type: "notice",
        text: "Not connected — your last action was not sent. Try again once reconnected.",
      });
    }
    return sent;
  }

  function send(mode: ComposerMode, content: string) {
    if (mode === "claude") {
      // Explicit invocation only: this is the sole path to Claude.
      sendOrWarn({ type: "claude.request", content, mode: "discussion_only" });
    } else {
      sendOrWarn({ type: "chat.send", content });
    }
  }

  function proposeFromMessage(message: MessageView) {
    setPrefill({ statement: message.content, sourceMessageId: message.id });
  }

  async function copyInvite() {
    if (!session?.inviteToken) return;
    const url = `${location.origin}/join/${roomId}#${session.inviteToken}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Two-step confirmation instead of window.confirm: works everywhere and
  // reads better ("End room" → "Really end for everyone?").
  function endRoom() {
    if (!confirmingEnd) {
      setConfirmingEnd(true);
      setTimeout(() => setConfirmingEnd(false), 5000);
      return;
    }
    setConfirmingEnd(false);
    sendOrWarn({ type: "room.end" });
  }

  return (
    <div className="room-layout">
      <header className="room-header">
        <div className="room-identity">
          <span className="wordmark">ClaudeRooms</span>
          <h1 className="room-name">{state.room?.name ?? "…"}</h1>
          {state.room?.repositoryName && (
            <span className="chip">
              {state.room.repositoryName}
              {state.room.branchName ? ` · ${state.room.branchName}` : ""}
            </span>
          )}
        </div>
        <div className="room-controls">
          <span
            className={`conn-badge ${state.connection}`}
            role="status"
            aria-live="polite"
          >
            {connectionLabel(state.connection)}
          </span>
          {isHost && session.inviteToken && state.room?.status === "open" && (
            <button className="btn small" onClick={copyInvite}>
              {copied ? "Copied ✓" : "Copy invitation link"}
            </button>
          )}
          {isHost && state.room?.status === "open" && (
            <button className="btn small danger" onClick={endRoom}>
              {confirmingEnd ? "Really end for everyone?" : "End room"}
            </button>
          )}
        </div>
      </header>

      {state.notice && (
        <div className="notice" role="alert">
          <span>{state.notice}</span>
          <button
            className="link-btn"
            onClick={() => dispatch({ type: "dismissNotice" })}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="room-main">
        <ParticipantsList
          participants={participants}
          selfId={state.self?.id ?? null}
          claudeStatus={state.claudeStatus}
        />
        <section className="conversation" aria-label="Conversation">
          <Timeline state={state} onProposeFromMessage={proposeFromMessage} />
          <Composer disabled={!roomOpen} onSend={send} />
          {state.room?.status === "ended" && (
            <p className="muted small ended-note">
              This room has ended. The history above is preserved locally on the host's
              machine.
            </p>
          )}
        </section>
        <DecisionsPanel
          decisions={Object.values(state.decisions).sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
          )}
          isHost={isHost}
          disabled={!roomOpen}
          prefill={prefill}
          onClearPrefill={() => setPrefill(null)}
          onPropose={(input) => sendOrWarn({ type: "decision.propose", ...input })}
          onResolve={(decisionId, status) =>
            sendOrWarn({ type: "decision.resolve", decisionId, status })
          }
        />
      </div>
    </div>
  );
}
