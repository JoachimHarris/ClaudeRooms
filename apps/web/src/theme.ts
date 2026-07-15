import { useEffect, useState } from "react";

// Theme preference: "system" follows the OS, "light"/"dark" force it.
// The resolved theme is stamped on <html data-theme> so CSS can override
// the default light tokens; "system" leaves the attribute off and lets the
// prefers-color-scheme media query decide (no flash, works without JS).

export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "clauderooms:theme";

function readStored(): ThemePref {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", pref);
  }
}

export function useTheme(): {
  pref: ThemePref;
  resolved: ResolvedTheme;
  cycle: () => void;
} {
  const [pref, setPref] = useState<ThemePref>(() => readStored());
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(() =>
    systemTheme(),
  );

  useEffect(() => {
    apply(pref);
    localStorage.setItem(STORAGE_KEY, pref);
  }, [pref]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemResolved(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolved: ResolvedTheme = pref === "system" ? systemResolved : pref;

  // Cycle system → light → dark → system, so power users can pin either and
  // everyone else can fall back to following the OS.
  function cycle() {
    setPref((current) =>
      current === "system" ? "light" : current === "light" ? "dark" : "system",
    );
  }

  return { pref, resolved, cycle };
}
