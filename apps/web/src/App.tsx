import { useEffect, useState } from "react";
import { matchRoute, navigate, usePath } from "./router.js";
import { useTheme } from "./theme.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { RoomRail } from "./components/RoomRail.js";
import { HowItWorks } from "./components/HowItWorks.js";
import { HomePage } from "./pages/HomePage.js";
import { JoinPage } from "./pages/JoinPage.js";
import { RoomPage } from "./pages/RoomPage.js";

/** Anything (e.g. a "? Help" button on any page) can reopen the intro. */
export const HELP_EVENT = "clauderooms:open-help";
export function openHelp(): void {
  document.dispatchEvent(new Event(HELP_EVENT));
}

export function App() {
  const path = usePath();
  const route = matchRoute(path);
  // Owned once here so a forced theme applies on every page, before any
  // page-level chrome mounts.
  const { pref, cycle } = useTheme();

  // The intro lives at the app root so it runs on the FIRST launch of the
  // program, whatever screen you land on — the host on "Start a session", a
  // guest straight in a room — and only once (remembered in the browser). The
  // "? Help" button on any page reopens it.
  const [showIntro, setShowIntro] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("clauderooms:intro-seen")) {
        setShowIntro(true);
        localStorage.setItem("clauderooms:intro-seen", "1");
      }
    } catch {
      /* localStorage unavailable — skip the intro rather than crash */
    }
    const open = () => setShowIntro(true);
    document.addEventListener(HELP_EVENT, open);
    return () => document.removeEventListener(HELP_EVENT, open);
  }, []);

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
      <HowItWorks open={showIntro} onClose={() => setShowIntro(false)} />
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
