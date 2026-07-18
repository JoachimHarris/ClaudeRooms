import fs from "node:fs";
import path from "node:path";
import { isDeniedByName } from "./repo-access.js";

// The policy that decides what Claude may WRITE to the host's repository
// (Milestone 7). Like RepoAccessPolicy it only answers "is this path allowed?"
// plus a size ceiling — it never decides *what* to write — so it is fully
// unit-testable and fails closed.
//
// Writes differ from reads in one important way: the target file may not exist
// yet, so we cannot resolve its real path. Instead we resolve the target's
// PARENT directory (which must exist and sit inside the repo) and refuse to
// write *through* a symlink. We never create directories.

/** Same 1 MiB ceiling reads use — a write is not a place to smuggle a blob. */
const MAX_WRITABLE_BYTES = 1024 * 1024;

export type WriteDecision =
  | { allowed: true; realPath: string; relativePath: string }
  | { allowed: false; reason: string };

export class RepoWritePolicy {
  private readonly root: string;

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
   * Decides whether `content` may be written to `candidate`. Containment is
   * checked on the REAL parent directory, so a symlinked directory or a
   * `../` escape is rejected even for a file that does not exist yet.
   */
  checkWrite(candidate: string, byteLength: number): WriteDecision {
    if (!candidate || typeof candidate !== "string") {
      return { allowed: false, reason: "no path given" };
    }
    if (!Number.isFinite(byteLength) || byteLength < 0) {
      return { allowed: false, reason: "invalid content" };
    }
    if (byteLength > MAX_WRITABLE_BYTES) {
      return { allowed: false, reason: "content is too large to write" };
    }

    const absolute = path.isAbsolute(candidate)
      ? candidate
      : path.join(this.root, candidate);

    // Deny by name on the requested path (credential files, denied dirs) before
    // touching the filesystem.
    const deniedByRequested = isDeniedByName(absolute, this.root);
    if (deniedByRequested) return { allowed: false, reason: deniedByRequested };

    // The parent must already exist and resolve inside the repo — we never
    // create directories, and this is what stops a symlinked dir or a path
    // outside the repository.
    const parent = path.dirname(absolute);
    let realParent: string;
    try {
      realParent = fs.realpathSync(parent);
    } catch {
      return {
        allowed: false,
        reason: "the target directory does not exist in the repository",
      };
    }
    const relativeParent = path.relative(this.root, realParent);
    if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) {
      return { allowed: false, reason: "path is outside the repository" };
    }

    const realPath = path.join(realParent, path.basename(absolute));

    // If the target exists it must be a plain file inside the repo: never write
    // through a symlink (it could launder an outside target) or over a directory.
    try {
      const stats = fs.lstatSync(realPath);
      if (stats.isSymbolicLink()) {
        return { allowed: false, reason: "refusing to write through a symlink" };
      }
      if (stats.isDirectory()) {
        return { allowed: false, reason: "path is a directory, not a file" };
      }
    } catch {
      /* does not exist yet — creating a new file is fine */
    }

    // Re-check the resolved name too: a symlinked parent could have relocated
    // the write onto a denied basename.
    const deniedByReal = isDeniedByName(realPath, this.root);
    if (deniedByReal) return { allowed: false, reason: deniedByReal };

    return {
      allowed: true,
      realPath,
      relativePath: path.relative(this.root, realPath),
    };
  }
}

export class WriteRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WriteRefused";
  }
}

/**
 * Performs an approved write. Re-validates through the policy immediately
 * before touching disk (defense in depth: the check and the write are never
 * separated by trust), then writes the file. Returns the repo-relative path so
 * the room can audit it without ever seeing the host's absolute path.
 */
export function applyWrite(
  policy: RepoWritePolicy,
  candidate: string,
  content: string,
): { relativePath: string } {
  const decision = policy.checkWrite(candidate, Buffer.byteLength(content, "utf8"));
  if (!decision.allowed) throw new WriteRefused(decision.reason);
  fs.writeFileSync(decision.realPath, content, "utf8");
  return { relativePath: decision.relativePath };
}
