import fs from "node:fs";
import path from "node:path";
import type { DecisionView } from "@clauderooms/shared";

// Milestone 8 (additive): a room's decisions are exported to a convention file
// in the repository, `.clauderooms/DECISIONS.md`, so a future Claude Code or
// Claude Desktop session in the same repo picks them up as context the way it
// reads CLAUDE.md. The host writes it locally; nothing here reaches the engine.
//
// The renderer is pure (decisions in, deterministic markdown out) so it is
// unit-testable on its own; the writer only ever touches the one fixed path.

const EXPORT_DIR = ".clauderooms";
const EXPORT_FILE = "DECISIONS.md";

const STATUS_SECTIONS: ReadonlyArray<{
  status: DecisionView["status"];
  heading: string;
}> = [
  { status: "accepted", heading: "Accepted" },
  { status: "rejected", heading: "Rejected" },
  { status: "proposed", heading: "Open (proposed)" },
];

function renderDecision(decision: DecisionView): string {
  const lines = [`### ${decision.title}`, "", decision.statement];
  if (decision.rationale) {
    lines.push("", `_Rationale:_ ${decision.rationale}`);
  }
  return lines.join("\n");
}

/**
 * Renders a room's decisions as deterministic markdown. Ordering is stable
 * (by creation time) so re-exporting an unchanged set produces an identical
 * file — no spurious diffs.
 */
export function renderDecisionsMarkdown(decisions: readonly DecisionView[]): string {
  const ordered = [...decisions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const out: string[] = [
    "# Decisions",
    "",
    "Exported by ClaudeRooms. Not affiliated with or endorsed by Anthropic.",
    "This file is generated — edit decisions in the room, not here.",
  ];

  for (const { status, heading } of STATUS_SECTIONS) {
    const inSection = ordered.filter((decision) => decision.status === status);
    if (inSection.length === 0) continue;
    out.push("", `## ${heading}`);
    for (const decision of inSection) out.push("", renderDecision(decision));
  }

  if (ordered.length === 0) {
    out.push("", "_No decisions yet._");
  }
  return out.join("\n") + "\n";
}

/**
 * Writes the rendered decisions to `<repoRoot>/.clauderooms/DECISIONS.md`,
 * creating the `.clauderooms` directory if needed. The path is fixed and
 * resolved under the repo root, so this host-initiated export cannot be steered
 * elsewhere. Returns the repo-relative path written.
 */
export function exportDecisions(
  repoRoot: string,
  decisions: readonly DecisionView[],
): { relativePath: string } {
  if (!path.isAbsolute(repoRoot)) {
    throw new Error("repoRoot must be an absolute path");
  }
  const root = fs.realpathSync(repoRoot);
  const dir = path.join(root, EXPORT_DIR);
  const file = path.join(dir, EXPORT_FILE);
  // Belt and braces: the fixed join can only stay inside the repo, but assert
  // it rather than trust it.
  if (path.relative(root, file).startsWith("..")) {
    throw new Error("export path escaped the repository");
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, renderDecisionsMarkdown(decisions), "utf8");
  return { relativePath: path.join(EXPORT_DIR, EXPORT_FILE) };
}
