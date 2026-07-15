import type { ThemePref } from "../theme.js";

const LABEL: Record<ThemePref, string> = {
  system: "Theme: follows your system (click to force light)",
  light: "Theme: light (click to force dark)",
  dark: "Theme: dark (click to follow system)",
};

const ICON: Record<ThemePref, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

/** Compact control cycling system → light → dark. */
export function ThemeToggle({ pref, onCycle }: { pref: ThemePref; onCycle: () => void }) {
  return (
    <button
      className="btn small theme-toggle"
      onClick={onCycle}
      title={LABEL[pref]}
      aria-label={LABEL[pref]}
    >
      <span aria-hidden="true">{ICON[pref]}</span>
    </button>
  );
}
