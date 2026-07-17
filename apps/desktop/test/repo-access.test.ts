import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RepoAccessPolicy } from "../src/repo-access.js";

// Security gate for Milestone 5 (docs/security/threat-model.md): repository
// access must stay inside the repository, and must never hand over
// credentials. Built on a real temp filesystem — symlink escapes cannot be
// tested honestly with mocks.

let sandbox: string;
let repoRoot: string;
let outside: string;
let policy: RepoAccessPolicy;

beforeAll(() => {
  // realpath the sandbox: on macOS os.tmpdir() is itself behind a symlink
  // (/var → /private/var). Without this every path would differ from the
  // resolved root, and the "rejects an escape" tests would pass for the
  // wrong reason — hiding whether the symlink check is doing any work.
  sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "clauderooms-access-")),
  );
  repoRoot = path.join(sandbox, "repo");
  outside = path.join(sandbox, "outside");
  fs.mkdirSync(repoRoot);
  fs.mkdirSync(outside);

  // Ordinary repository content.
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# hello");
  fs.mkdirSync(path.join(repoRoot, "src"));
  fs.writeFileSync(path.join(repoRoot, "src", "index.ts"), "export {};");
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/");

  // Things that must never be shared.
  fs.writeFileSync(path.join(repoRoot, ".env"), "API_KEY=secret");
  fs.writeFileSync(path.join(repoRoot, ".env.production"), "API_KEY=prod");
  fs.writeFileSync(path.join(repoRoot, "server.pem"), "-----BEGIN KEY-----");
  fs.mkdirSync(path.join(repoRoot, ".git"));
  fs.writeFileSync(path.join(repoRoot, ".git", "config"), "[remote]");
  fs.mkdirSync(path.join(repoRoot, "node_modules"));
  fs.writeFileSync(path.join(repoRoot, "node_modules", "dep.js"), "//");

  // The neighbour's secret, and links reaching for it.
  fs.writeFileSync(path.join(outside, "secrets.txt"), "TOP SECRET");
  fs.symlinkSync(outside, path.join(repoRoot, "escape-dir"));
  fs.symlinkSync(path.join(outside, "secrets.txt"), path.join(repoRoot, "escape-file"));
  // A link that stays inside the repo but points at a denied file.
  fs.symlinkSync(path.join(repoRoot, ".env"), path.join(repoRoot, "innocent.txt"));

  policy = new RepoAccessPolicy(repoRoot);
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("RepoAccessPolicy — allows ordinary repository files", () => {
  it("allows a file at the root", () => {
    expect(policy.check(path.join(repoRoot, "README.md")).allowed).toBe(true);
  });

  it("allows a nested source file", () => {
    expect(policy.check(path.join(repoRoot, "src", "index.ts")).allowed).toBe(true);
  });

  it("resolves relative paths against the repo, not the process cwd", () => {
    const decision = policy.check("src/index.ts");
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.realPath).toBe(
        fs.realpathSync(path.join(repoRoot, "src/index.ts")),
      );
    }
  });

  it("allows harmless dotfiles like .gitignore", () => {
    expect(policy.check(path.join(repoRoot, ".gitignore")).allowed).toBe(true);
  });
});

describe("RepoAccessPolicy — refuses to leave the repository", () => {
  it("rejects traversal with ..", () => {
    const decision = policy.check(path.join(repoRoot, "..", "outside", "secrets.txt"));
    expect(decision.allowed).toBe(false);
  });

  it("rejects an absolute path elsewhere on the machine", () => {
    expect(policy.check("/etc/passwd").allowed).toBe(false);
  });

  it("rejects a symlinked FILE pointing outside the repo", () => {
    // The name is inside the repo; only resolving it reveals the escape.
    const decision = policy.check(path.join(repoRoot, "escape-file"));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/outside the repository/);
  });

  it("rejects a file reached through a symlinked DIRECTORY", () => {
    const decision = policy.check(path.join(repoRoot, "escape-dir", "secrets.txt"));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/outside the repository/);
  });

  it("rejects a path that does not exist", () => {
    expect(policy.check(path.join(repoRoot, "nope.txt")).allowed).toBe(false);
  });
});

describe("RepoAccessPolicy — never shares credentials", () => {
  it.each([".env", ".env.production", "server.pem"])("rejects %s", (name) => {
    const decision = policy.check(path.join(repoRoot, name));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/credentials/);
  });

  it("rejects anything inside .git", () => {
    expect(policy.check(path.join(repoRoot, ".git", "config")).allowed).toBe(false);
  });

  it("rejects node_modules", () => {
    expect(policy.check(path.join(repoRoot, "node_modules", "dep.js")).allowed).toBe(
      false,
    );
  });

  it("rejects a symlink that launders a denied file behind an innocent name", () => {
    // innocent.txt → .env, both inside the repo: the containment check passes,
    // so only checking the RESOLVED name catches this.
    const decision = policy.check(path.join(repoRoot, "innocent.txt"));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/credentials/);
  });
});

describe("RepoAccessPolicy — misuse", () => {
  it("refuses a relative repo root", () => {
    expect(() => new RepoAccessPolicy("relative/path")).toThrow(/absolute/);
  });

  it("rejects an empty path", () => {
    expect(policy.check("").allowed).toBe(false);
  });

  it("rejects oversized files", () => {
    const big = path.join(repoRoot, "big.txt");
    fs.writeFileSync(big, Buffer.alloc(1024 * 1024 + 1, "x"));
    const decision = policy.check(big);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/too large/);
    fs.rmSync(big);
  });
});
