import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RepoAccessPolicy } from "../src/repo-access.js";
import {
  checkToolCall,
  redactRepoRoots,
  REPOSITORY_READ_DISALLOWED,
  REPOSITORY_READ_TOOLS,
} from "../src/tool-gate.js";

// The tool-dispatch gate for repository_read (Milestone 5): which SDK tool
// calls are allowed, and how each maps onto the access policy. The policy
// itself is tested in repo-access.test.ts; here we test the dispatch.

let sandbox: string;
let repoRoot: string;
let policy: RepoAccessPolicy;

beforeAll(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clauderooms-gate-")));
  repoRoot = path.join(sandbox, "repo");
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "src", "index.ts"), "export {};");
  fs.writeFileSync(path.join(repoRoot, ".env"), "SECRET=1");
  policy = new RepoAccessPolicy(repoRoot);
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("checkToolCall — Read", () => {
  it("allows a repository file and records its relative path", () => {
    const decision = checkToolCall(policy, "Read", {
      file_path: path.join(repoRoot, "src", "index.ts"),
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.recordedPath).toBe("src/index.ts");
  });

  it("denies a credential file the policy refuses", () => {
    const decision = checkToolCall(policy, "Read", {
      file_path: path.join(repoRoot, ".env"),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/credentials/);
  });

  it("denies a read with no usable file path", () => {
    expect(checkToolCall(policy, "Read", {}).allowed).toBe(false);
    expect(checkToolCall(policy, "Read", { file_path: 42 }).allowed).toBe(false);
  });
});

describe("checkToolCall — Glob", () => {
  it("allows a glob with no path (searches the repo root)", () => {
    const decision = checkToolCall(policy, "Glob", { pattern: "**/*.ts" });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.recordedPath).toBeUndefined();
  });

  it("allows a glob scoped to a repository directory", () => {
    expect(
      checkToolCall(policy, "Glob", { pattern: "*.ts", path: path.join(repoRoot, "src") })
        .allowed,
    ).toBe(true);
  });

  it("denies a glob pointed outside the repository", () => {
    const decision = checkToolCall(policy, "Glob", { pattern: "*", path: sandbox });
    expect(decision.allowed).toBe(false);
  });
});

describe("checkToolCall — fails closed", () => {
  // The point of the gate: anything not explicitly handled is denied, so a
  // tool slipping into availability can never become usable by omission.
  it.each(["Grep", "Bash", "Write", "Edit", "WebFetch", "Task", "MysteryTool"])(
    "denies %s",
    (tool) => {
      const decision = checkToolCall(policy, tool, { anything: "x" });
      expect(decision.allowed).toBe(false);
    },
  );

  it("keeps Grep out of the available set (it can leak file contents)", () => {
    expect(REPOSITORY_READ_TOOLS).not.toContain("Grep");
    expect(REPOSITORY_READ_TOOLS).toEqual(["Read", "Glob"]);
  });

  it("every available tool is also handled by the gate", () => {
    // If someone adds a tool to REPOSITORY_READ_TOOLS, the gate must know it —
    // otherwise the SDK offers a tool that checkToolCall denies by default,
    // which is safe but broken. This keeps the two lists honest together.
    for (const tool of REPOSITORY_READ_TOOLS) {
      const decision = checkToolCall(policy, tool, {});
      // A handled tool returns *some* decision that isn't the default
      // "not permitted" message; unknown tools return that exact reason.
      if (!decision.allowed) {
        expect(decision.reason).not.toMatch(/is not permitted in a repository-read/);
      }
    }
  });

  it("names the search tools in the disallow list as belt-and-braces", () => {
    expect(REPOSITORY_READ_DISALLOWED).toContain("Bash");
    expect(REPOSITORY_READ_DISALLOWED).toContain("Grep");
  });
});

describe("redactRepoRoots — the host's absolute path never leaves the process", () => {
  // ADR-0007: the absolute repo path stays inside the Electron main process.
  // Claude's narration (which we do not control) can echo it, so the runner
  // strips it out of every byte of output. This is the hard guard behind that
  // promise; the system prompt asking for relative paths is only the soft one.
  const root = "/Users/someone/Desktop/code/ClaudeRooms";

  it("turns an absolute file path into a repo-relative one", () => {
    const leaked = `I read ${root}/package.json — it's named clauderooms.`;
    expect(redactRepoRoots(leaked, [root])).toBe(
      "I read package.json — it's named clauderooms.",
    );
  });

  it("collapses a bare repo root to just its directory name", () => {
    // The directory name is display metadata the room already shows; the
    // absolute path above it is what must never appear.
    expect(redactRepoRoots(`The project lives in ${root}.`, [root])).toBe(
      "The project lives in ClaudeRooms.",
    );
  });

  it("redacts every occurrence, not just the first", () => {
    const leaked = `${root}/a.ts and ${root}/b.ts`;
    expect(redactRepoRoots(leaked, [root])).toBe("a.ts and b.ts");
    expect(redactRepoRoots(leaked, [root])).not.toContain(root);
  });

  it("redacts either root when the picked path differs from its realpath", () => {
    const real = "/private/var/repo";
    const picked = "/var/repo";
    const leaked = `saw ${real}/x.ts via ${picked}/y.ts`;
    expect(redactRepoRoots(leaked, [real, picked])).toBe("saw x.ts via y.ts");
  });

  it("leaves text without the root untouched", () => {
    const clean = "The package manager is pnpm@9.15.9.";
    expect(redactRepoRoots(clean, [root])).toBe(clean);
  });

  it("ignores an empty root (no accidental blanket replacement)", () => {
    const text = "some text";
    expect(redactRepoRoots(text, ["", root])).toBe(text);
  });
});
