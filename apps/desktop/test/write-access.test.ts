import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RepoWritePolicy, WriteRefused, applyWrite } from "../src/write-access.js";

// The write policy for Milestone 7. It decides which paths Claude's approved
// writes may land on; the ActionProposal flow (step 2) sits on top. The
// filesystem here is real (a temp sandbox) so containment and symlink handling
// are exercised for real, and the sandbox root is realpath'd up front — on
// macOS /var is a symlink, and without this every path would differ from the
// resolved root and the containment tests would pass for the wrong reason.

let sandbox: string;
let repoRoot: string;
let policy: RepoWritePolicy;

beforeAll(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clauderooms-write-")));
  repoRoot = path.join(sandbox, "repo");
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "existing.txt"), "old");
  // A place outside the repo, and a symlink from inside the repo to it.
  fs.mkdirSync(path.join(sandbox, "outside"));
  fs.symlinkSync(path.join(sandbox, "outside"), path.join(repoRoot, "escape"));
  policy = new RepoWritePolicy(repoRoot);
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("RepoWritePolicy.checkWrite", () => {
  it("allows a new file in a repository directory", () => {
    const decision = policy.checkWrite("src/new.ts", 10);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.relativePath).toBe("src/new.ts");
  });

  it("allows overwriting an existing plain file", () => {
    expect(policy.checkWrite("existing.txt", 3).allowed).toBe(true);
  });

  it("denies a credential file by name", () => {
    const decision = policy.checkWrite(".env", 5);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/credentials/);
  });

  it("denies writing under a denied directory", () => {
    expect(policy.checkWrite(".git/config", 5).allowed).toBe(false);
  });

  it("denies a path whose parent is outside the repository", () => {
    expect(policy.checkWrite("../outside/evil.txt", 5).allowed).toBe(false);
    expect(policy.checkWrite(path.join(sandbox, "outside", "evil.txt"), 5).allowed).toBe(
      false,
    );
  });

  it("denies writing through a symlinked directory that escapes the repo", () => {
    // repo/escape → sandbox/outside; writing repo/escape/x lands outside.
    const decision = policy.checkWrite("escape/x.txt", 5);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/outside the repository/);
  });

  it("denies writing when the target directory does not exist", () => {
    expect(policy.checkWrite("nope/deep/x.txt", 5).allowed).toBe(false);
  });

  it("denies content over the size ceiling", () => {
    expect(policy.checkWrite("src/big.bin", 1024 * 1024 + 1).allowed).toBe(false);
  });

  it("refuses to write through a symlinked FILE", () => {
    fs.symlinkSync(
      path.join(sandbox, "outside", "target.txt"),
      path.join(repoRoot, "linkfile.txt"),
    );
    const decision = policy.checkWrite("linkfile.txt", 5);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/symlink/);
  });
});

describe("applyWrite", () => {
  it("writes an allowed file and returns its repo-relative path", () => {
    const result = applyWrite(policy, "src/applied.ts", "export const ok = 1;\n");
    expect(result.relativePath).toBe("src/applied.ts");
    expect(fs.readFileSync(path.join(repoRoot, "src", "applied.ts"), "utf8")).toContain(
      "export const ok",
    );
  });

  it("overwrites an existing file's contents", () => {
    applyWrite(policy, "existing.txt", "new");
    expect(fs.readFileSync(path.join(repoRoot, "existing.txt"), "utf8")).toBe("new");
  });

  it("throws WriteRefused for a denied path and writes nothing", () => {
    expect(() => applyWrite(policy, ".env", "SECRET=1")).toThrow(WriteRefused);
    expect(fs.existsSync(path.join(repoRoot, ".env"))).toBe(false);
  });
});
