import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DecisionView } from "@clauderooms/shared";
import { exportDecisions, renderDecisionsMarkdown } from "../src/decisions-export.js";

// Milestone 8: decisions exported to `.clauderooms/DECISIONS.md` for a future
// Claude session's context. The renderer is pure; the writer only ever touches
// the one fixed path under the repo root.

function decision(overrides: Partial<DecisionView>): DecisionView {
  return {
    id: "d",
    roomId: "r",
    title: "T",
    statement: "S",
    rationale: null,
    status: "accepted",
    createdByParticipantId: "p",
    resolvedByParticipantId: null,
    sourceMessageId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

describe("renderDecisionsMarkdown", () => {
  it("keeps the not-affiliated notice", () => {
    expect(renderDecisionsMarkdown([])).toContain("Not affiliated with or endorsed");
  });

  it("groups by status and includes rationale when present", () => {
    const md = renderDecisionsMarkdown([
      decision({ title: "Use pnpm", status: "accepted", rationale: "monorepo" }),
      decision({ title: "No Kanban", status: "rejected" }),
      decision({ title: "Maybe SSO", status: "proposed" }),
    ]);
    expect(md).toContain("## Accepted");
    expect(md).toContain("### Use pnpm");
    expect(md).toContain("_Rationale:_ monorepo");
    expect(md).toContain("## Rejected");
    expect(md).toContain("## Open (proposed)");
  });

  it("is stable: same input → identical output (no spurious diffs)", () => {
    const decisions = [
      decision({ id: "a", title: "A", createdAt: "2026-01-02T00:00:00.000Z" }),
      decision({ id: "b", title: "B", createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const first = renderDecisionsMarkdown(decisions);
    // Re-run with the input in a different order — output is sorted by createdAt.
    const second = renderDecisionsMarkdown([...decisions].reverse());
    expect(first).toBe(second);
    expect(first.indexOf("### B")).toBeLessThan(first.indexOf("### A"));
  });

  it("handles an empty room", () => {
    expect(renderDecisionsMarkdown([])).toContain("_No decisions yet._");
  });
});

describe("exportDecisions", () => {
  let repoRoot: string;

  beforeAll(() => {
    repoRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "clauderooms-dec-")),
    );
  });

  afterAll(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("writes .clauderooms/DECISIONS.md under the repo root", () => {
    const { relativePath } = exportDecisions(repoRoot, [
      decision({ title: "Desktop-first" }),
    ]);
    expect(relativePath).toBe(path.join(".clauderooms", "DECISIONS.md"));
    const written = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    expect(written).toContain("### Desktop-first");
  });

  it("rejects a non-absolute repo root", () => {
    expect(() => exportDecisions("relative/path", [])).toThrow();
  });
});
