import fs from "node:fs";
import path from "node:path";

// The policy that decides what Claude may read from the host's repository
// (Milestone 5). Nothing here reads file contents — it only answers
// "is this path allowed?", so it can be unit-tested in full and reasoned
// about on its own.
//
// It is consulted from `canUseTool` for every repository tool call, which is
// the only place the SDK asks permission before touching the filesystem.
// Fail closed: anything it cannot resolve or does not recognise is denied.

/** Directories never worth exposing — either secrets or noise. */
const DENIED_DIR_SEGMENTS = new Set([
  ".git", // history, config with remote credentials, hooks
  ".ssh",
  ".aws",
  ".gnupg",
  ".config",
  "node_modules", // not secret, but megabytes of other people's code
  ".venv",
  "venv",
]);

/** Files that routinely hold credentials. Matched on the basename. */
const DENIED_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i, // .env, .env.local, .env.production…
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.pgpass$/i,
  /^credentials$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /^.*\.env$/i, // e.g. local.env
];

/** Refuse to hand Claude a file larger than this (1 MiB). */
const MAX_READABLE_BYTES = 1024 * 1024;

export type AccessDecision =
  { allowed: true; realPath: string } | { allowed: false; reason: string };

// Exported so the write policy (write-access.ts) shares the exact same
// credential/denied-directory list — reads and writes must never disagree
// about what is off-limits.
export function isDeniedByName(candidate: string, repoRoot: string): string | null {
  const relative = path.relative(repoRoot, candidate);
  const segments = relative.split(path.sep).filter(Boolean);

  for (const segment of segments.slice(0, -1)) {
    if (DENIED_DIR_SEGMENTS.has(segment)) {
      return `'${segment}/' is not shared with Claude`;
    }
  }
  const basename = segments.at(-1) ?? "";
  if (DENIED_DIR_SEGMENTS.has(basename)) {
    return `'${basename}' is not shared with Claude`;
  }
  for (const pattern of DENIED_FILE_PATTERNS) {
    if (pattern.test(basename)) {
      return `'${basename}' looks like it holds credentials and is never shared`;
    }
  }
  return null;
}

export class RepoAccessPolicy {
  private readonly root: string;

  /**
   * @param repoRoot absolute path to the repository the host picked. It is
   *   resolved through symlinks once, so a symlinked root still works while
   *   escapes from inside it are still caught.
   */
  constructor(repoRoot: string) {
    if (!path.isAbsolute(repoRoot)) {
      throw new Error("repoRoot must be an absolute path");
    }
    this.root = fs.realpathSync(repoRoot);
  }

  get repoRoot(): string {
    return this.root;
  }

  /**
   * Decides whether `candidate` may be read. Resolves the real path first,
   * so symlinks pointing outside the repository are rejected even though
   * their name sits inside it.
   */
  check(candidate: string): AccessDecision {
    if (!candidate || typeof candidate !== "string") {
      return { allowed: false, reason: "no path given" };
    }

    // Resolve relative paths against the repo, never against process.cwd().
    const absolute = path.isAbsolute(candidate)
      ? candidate
      : path.join(this.root, candidate);

    let realPath: string;
    try {
      realPath = fs.realpathSync(absolute);
    } catch {
      // Missing file, or a broken/looping symlink. Deny rather than let the
      // tool discover the difference — that itself leaks existence.
      return { allowed: false, reason: "path does not exist in the repository" };
    }

    // The containment check runs on the REAL path: this is what stops
    // `repo/link-to-etc/passwd` and `../../.ssh/id_rsa` alike.
    const relative = path.relative(this.root, realPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return { allowed: false, reason: "path is outside the repository" };
    }

    // Check names on both the requested and the resolved path: a symlink
    // *inside* the repo must not launder a denied target (link → .env).
    const deniedByRequested = isDeniedByName(absolute, this.root);
    if (deniedByRequested) return { allowed: false, reason: deniedByRequested };
    const deniedByReal = isDeniedByName(realPath, this.root);
    if (deniedByReal) return { allowed: false, reason: deniedByReal };

    const stats = fs.statSync(realPath);
    if (stats.isFile() && stats.size > MAX_READABLE_BYTES) {
      return { allowed: false, reason: "file is too large to share" };
    }

    return { allowed: true, realPath };
  }
}
