import { useEffect, useState } from "react";

// Three static routes do not justify a router dependency (ADR-0002).

export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type Route =
  | { page: "home" }
  | { page: "join"; roomId: string }
  | { page: "room"; roomId: string }
  | { page: "notFound" };

export function matchRoute(path: string): Route {
  if (path === "/") return { page: "home" };
  const join = path.match(new RegExp(`^/join/(${UUID})$`, "i"));
  if (join?.[1]) return { page: "join", roomId: join[1] };
  const room = path.match(new RegExp(`^/room/(${UUID})$`, "i"));
  if (room?.[1]) return { page: "room", roomId: room[1] };
  return { page: "notFound" };
}
