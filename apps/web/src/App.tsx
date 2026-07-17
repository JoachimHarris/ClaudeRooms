import { matchRoute, navigate, usePath } from "./router.js";
import { useTheme } from "./theme.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { RoomRail } from "./components/RoomRail.js";
import { HomePage } from "./pages/HomePage.js";
import { JoinPage } from "./pages/JoinPage.js";
import { RoomPage } from "./pages/RoomPage.js";

export function App() {
  const path = usePath();
  const route = matchRoute(path);
  // Owned once here so a forced theme applies on every page, before any
  // page-level chrome mounts.
  const { pref, cycle } = useTheme();

  // The rail is the host's workspace shell: desktop only, and never on the
  // guest join flow (a guest has exactly one room — the link they opened).
  const showRail = Boolean(window.clauderooms) && route.page !== "join";
  const activeRoomId = route.page === "room" ? route.roomId : null;

  return (
    <div className={showRail ? "app-shell with-rail" : "app-shell"}>
      {showRail && <RoomRail activeRoomId={activeRoomId} />}
      <div className="app-main">
        <div className="theme-toggle-slot">
          <ThemeToggle pref={pref} onCycle={cycle} />
        </div>
        {renderRoute()}
      </div>
    </div>
  );

  function renderRoute() {
    switch (route.page) {
      case "home":
        return <HomePage />;
      case "join":
        return <JoinPage roomId={route.roomId} />;
      case "room":
        return <RoomPage key={route.roomId} roomId={route.roomId} />;
      case "notFound":
        return (
          <main className="centered-page">
            <h1>Not found</h1>
            <p>
              <button className="btn" onClick={() => navigate("/")}>
                Back to start
              </button>
            </p>
          </main>
        );
    }
  }
}
