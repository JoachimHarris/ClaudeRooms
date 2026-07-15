import { matchRoute, navigate, usePath } from "./router.js";
import { HomePage } from "./pages/HomePage.js";
import { JoinPage } from "./pages/JoinPage.js";
import { RoomPage } from "./pages/RoomPage.js";

export function App() {
  const path = usePath();
  const route = matchRoute(path);

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
