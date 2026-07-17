import path from "node:path";
import type { RepoAccessPolicy } from "./repo-access.js";

// The tool-dispatch gate for repository_read (Milestone 5). It decides which
// SDK tool calls are allowed and turns each one into a path the access policy
// can rule on. Kept apart from claude-runner.ts — which imports the Agent SDK
// and spawns the CLI — so this security-relevant logic is unit-testable on
// its own, exactly like repo-access.ts.

// Which built-in tools exist at all for an approved request. The SDK's
// `tools` option is the availability gate (`allowedTools` is only
// auto-approval — see the discussion-only gate list in claude-runner.ts).
//
// Grep is deliberately NOT here. `canUseTool` can gate a *call*, not a
// *result*: Grep searches file contents and returns matching lines, so a
// pattern like "API_KEY" could print secrets out of a file we would never let
// Claude open. Read is safe because the path it names is checked first; Glob
// only returns names. Grep needs result-level redaction — a later step.
export const REPOSITORY_READ_TOOLS = ["Read", "Glob"];

// Belt and braces. The SDK warns that "native builds may provide search via
// Bash find/grep instead of the dedicated Grep/Glob tools", so Bash must be
// named explicitly — an omitted tool is not the same as a denied one.
export const REPOSITORY_READ_DISALLOWED = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Grep",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
];

export type ToolGateDecision =
  { allowed: true; recordedPath?: string } | { allowed: false; reason: string };

/**
 * Strips the host's absolute repository path out of any text Claude produces.
 *
 * The tool-gate records repo-*relative* paths, but Claude's own narration —
 * which we do not control — can echo the absolute path a tool result showed it
 * (the run's cwd is the repo root, so `Read` results name absolute paths).
 * ADR-0007 promises the absolute repo path never leaves the Electron main
 * process, so we strip it here, in the host, before the text is handed to the
 * engine. Asking Claude for relative paths in the system prompt is a soft
 * guard; this is the hard one, and it is what makes the promise true.
 *
 * `root + sep` collapses to the repo-relative remainder ("…/repo/src/x" →
 * "src/x"); a bare `root` collapses to the repo's own directory name, which is
 * display metadata the room already shows. String split/join is used (not a
 * RegExp) so path characters never need escaping.
 */
export function redactRepoRoots(text: string, roots: readonly string[]): string {
  let out = text;
  for (const root of roots) {
    if (!root) continue;
    out = out.split(root + path.sep).join("");
    out = out.split(root).join(path.basename(root));
  }
  return out;
}

/**
 * Maps one tool call onto the access policy. Fails closed: a tool we do not
 * recognise is denied, so adding a name to REPOSITORY_READ_TOOLS without
 * teaching this function about it cannot silently open a hole.
 */
export function checkToolCall(
  policy: RepoAccessPolicy,
  toolName: string,
  toolInput: Record<string, unknown>,
): ToolGateDecision {
  switch (toolName) {
    case "Read": {
      const filePath = toolInput.file_path;
      if (typeof filePath !== "string") {
        return { allowed: false, reason: "the read had no file path" };
      }
      const decision = policy.check(filePath);
      if (!decision.allowed) return { allowed: false, reason: decision.reason };
      return {
        allowed: true,
        // Relative: the room must never see the host's absolute paths.
        recordedPath: path.relative(policy.repoRoot, decision.realPath),
      };
    }
    case "Glob": {
      // `path` is the directory to search; omitted means cwd (= repo root).
      const searchPath = toolInput.path;
      if (searchPath === undefined) return { allowed: true };
      if (typeof searchPath !== "string") {
        return { allowed: false, reason: "the search path was not a path" };
      }
      const decision = policy.check(searchPath);
      if (!decision.allowed) return { allowed: false, reason: decision.reason };
      return { allowed: true };
    }
    default:
      return {
        allowed: false,
        reason: `'${toolName}' is not permitted in a repository-read request`,
      };
  }
}
