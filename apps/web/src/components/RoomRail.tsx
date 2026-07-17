import { useCallback, useEffect, useState } from "react";
import { navigate } from "../router.js";

// The host's persistent rail of rooms (Milestone 4). Desktop only: it is
// driven by the app's encrypted room store (ADR-0008), which a browser has
// no equivalent of. Credentials never come through here — summaries only.

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const second = words[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

export function RoomRail({ activeRoomId }: { activeRoomId: string | null }) {
  const [rooms, setRooms] = useState<DesktopRoomSummary[]>([]);
  const [canPersist, setCanPersist] = useState(true);

  const refresh = useCallback(async () => {
    const result = await window.clauderooms?.listRooms();
    if (!result) return;
    setRooms(result.rooms);
    setCanPersist(result.canPersist);
  }, []);

  // Refresh when the route changes: that is when a room was just created,
  // opened, or ended.
  useEffect(() => {
    void refresh();
  }, [refresh, activeRoomId]);

  async function forget(event: React.MouseEvent, roomId: string) {
    event.stopPropagation();
    await window.clauderooms?.forgetRoom({ roomId });
    await refresh();
    if (roomId === activeRoomId) navigate("/");
  }

  return (
    <nav className="rail" aria-label="Your rooms">
      <button
        className={`rail-new ${activeRoomId === null ? "active" : ""}`}
        onClick={() => navigate("/")}
        title="Start a new session"
      >
        +
      </button>

      <ul className="rail-list">
        {rooms.map((room) => {
          const active = room.roomId === activeRoomId;
          return (
            <li key={room.roomId}>
              <button
                className={`rail-room ${active ? "active" : ""}`}
                onClick={() => navigate(`/room/${room.roomId}`)}
                title={
                  room.repositoryName
                    ? `${room.roomName} · ${room.repositoryName}`
                    : room.roomName
                }
                aria-current={active ? "page" : undefined}
              >
                <span className="rail-avatar" aria-hidden="true">
                  {initials(room.roomName)}
                </span>
                <span className="rail-meta">
                  <span className="rail-name">{room.roomName}</span>
                  {room.repositoryName && (
                    <span className="rail-repo">
                      {room.repositoryName}
                      {room.branchName ? ` · ${room.branchName}` : ""}
                    </span>
                  )}
                </span>
                <span
                  className="rail-forget"
                  role="button"
                  tabIndex={0}
                  aria-label={`Forget ${room.roomName}`}
                  onClick={(event) => void forget(event, room.roomId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      void window.clauderooms
                        ?.forgetRoom({ roomId: room.roomId })
                        .then(refresh);
                    }
                  }}
                >
                  ✕
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {!canPersist && (
        // Honest, not silent: without OS encryption we refuse to store
        // tokens, so rooms cannot be remembered (ADR-0008).
        <p className="rail-note muted small">
          Rooms can’t be remembered: this system has no secure storage.
        </p>
      )}
    </nav>
  );
}
