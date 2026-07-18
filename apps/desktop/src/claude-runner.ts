import { query } from "@anthropic-ai/claude-agent-sdk";
import { RepoAccessPolicy } from "./repo-access.js";
import {
  checkToolCall,
  redactRepoRoots,
  REPOSITORY_READ_DISALLOWED,
  REPOSITORY_READ_TOOLS,
} from "./tool-gate.js";

// Runs real Claude on the host machine via the Claude Agent SDK, inside the
// Electron main process — the only place that knows the repository path and
// where the host's own Claude Code credentials live. Nothing here is ever
// reachable from the renderer or the engine.
//
// Milestone 3 is discussion_only: Claude may reason and answer, but nothing
// from the repository may reach it. Every gate below is load-bearing — this
// was verified by asking Claude to quote CLAUDE.md and watching it succeed
// until all four were in place:
//   1. tools: []           — THE one that actually removes the built-in tools.
//   2. settingSources: []  — omitting this loads user/project/local settings
//      "matching CLI defaults", which pulls CLAUDE.md into the system prompt.
//   3. allowedTools: []    — does NOT restrict availability; it means
//      "auto-approve nothing". Kept so nothing is ever silently auto-allowed.
//   4. canUseTool → deny   — last resort; only fires when the permission flow
//      reaches a prompt, so it cannot be relied on alone.
// A collaborator could otherwise extract repository context by just asking.

const DISCUSSION_ONLY_PROMPT = [
  "You are Claude, taking part in a shared ClaudeRooms session with a small",
  "team around one of their repositories. Several people can read your",
  "answers, and someone other than the repository's owner may be asking.",
  "",
  "In this mode you have no access to the repository, the filesystem, or any",
  "tools — only what is written in the request itself. If you are asked for",
  "file contents or anything else you cannot see, say plainly that you do not",
  "have repository access in this mode and answer what you can from the",
  "conversation. Never guess at file contents and present it as fact.",
  "",
  "Answer directly and concisely, as a colleague in a discussion.",
].join("\n");

export interface ClaudeRunEvents {
  onStarted: () => void;
  onDelta: (text: string) => void;
  onCompleted: (text: string) => void;
  onFailed: (failureCode: string, message: string) => void;
  /** Repository paths Claude was actually allowed to open, relative to the
   *  repo root. Absolute paths never leave this process (ADR-0007). */
  onRepoAccess?: (files: string[]) => void;
}

// ---------------------------------------------------------------------------
// repository_read (Milestone 5). The tool-availability lists and the
// per-call gate live in tool-gate.ts so they can be unit-tested without the
// Agent SDK; see the reasoning (esp. why Grep is excluded) there.
// ---------------------------------------------------------------------------

const REPOSITORY_READ_PROMPT = [
  "You are Claude, taking part in a shared ClaudeRooms session with a small",
  "team around one of their repositories. Several people can read your",
  "answers, and someone other than the repository's owner may be asking.",
  "",
  "The owner has allowed you to read this repository for THIS request only.",
  "You can open files (Read) and find them (Glob). You cannot run commands,",
  "search file contents, edit anything, or reach the network.",
  "",
  "Some paths are refused on purpose — anything holding credentials, and",
  "anything outside the repository. If a read is refused, say so plainly and",
  "work with what you can see. Never guess at a file's contents and present",
  "it as fact, and never repeat a secret you happen to come across.",
  "",
  "Answer directly and concisely, as a colleague in a discussion. Mention",
  "which files you looked at, and always name them by their path relative to",
  "the repository root (e.g. `apps/server/src/rooms.ts`) — never write out an",
  "absolute filesystem path.",
].join("\n");

/**
 * Runs an approved repository_read request. Every tool call is checked
 * against `RepoAccessPolicy` before it happens; anything the policy refuses
 * is denied with its reason, which Claude then explains in the room.
 */
export function runRepositoryRead(input: {
  content: string;
  repoPath: string;
  events: ClaudeRunEvents;
}): ClaudeRunHandle {
  const abort = new AbortController();
  const policy = new RepoAccessPolicy(input.repoPath);
  // Paths actually opened, so the room can show what was looked at.
  const readFiles = new Set<string>();
  // Both the real (realpath'd) root and the picked path — Claude's narration
  // could echo either. Redacted out of every byte before it leaves the host.
  const repoRoots = [policy.repoRoot, input.repoPath];
  const redact = (text: string) => redactRepoRoots(text, repoRoots);

  void (async () => {
    let assembled = "";
    let started = false;
    try {
      const response = query({
        prompt: input.content,
        options: {
          cwd: policy.repoRoot,
          abortController: abort,
          includePartialMessages: true,
          systemPrompt: REPOSITORY_READ_PROMPT,
          tools: REPOSITORY_READ_TOOLS,
          disallowedTools: REPOSITORY_READ_DISALLOWED,
          // Still [] — this loads user/project settings and would drag
          // CLAUDE.md into the prompt (proven in Milestone 3).
          settingSources: [],
          // Still [] — auto-approve nothing.
          allowedTools: [],
          // LOAD-BEARING (proven in Milestone 5 testing). `allowedTools: []`
          // is NOT enough: in the default permission mode the SDK treats
          // read-only tools (Read/Glob) as safe and auto-approves them
          // *without ever calling canUseTool* — so RepoAccessPolicy never ran
          // and a collaborator's "read .env" would have succeeded. Forcing
          // every available tool onto the `ask` list routes each call through
          // canUseTool below, which is where the policy is enforced. Verified:
          // with this line a `.env` read is denied; without it, canUseTool
          // fires zero times and the read goes through. Keep `ask` === the
          // available-tools set so no tool can be auto-approved by omission.
          settings: { permissions: { ask: REPOSITORY_READ_TOOLS } },
          canUseTool: async (toolName, toolInput) => {
            const decision = checkToolCall(policy, toolName, toolInput);
            if (!decision.allowed) {
              return {
                behavior: "deny",
                message: `ClaudeRooms refused this: ${decision.reason}`,
              };
            }
            if (decision.recordedPath) readFiles.add(decision.recordedPath);
            return { behavior: "allow", updatedInput: toolInput };
          },
        },
      });

      for await (const message of response) {
        if (!started) {
          started = true;
          input.events.onStarted();
        }

        if (message.type === "stream_event") {
          const event = message.event;
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta" &&
            event.delta.text
          ) {
            assembled += event.delta.text;
            input.events.onDelta(redact(event.delta.text));
          }
          continue;
        }

        if (message.type === "assistant" && message.error) {
          input.events.onFailed(
            failureCodeFor(message.error),
            `Claude could not answer (${message.error}).`,
          );
          return;
        }

        if (message.type === "result") {
          if (readFiles.size > 0) {
            input.events.onRepoAccess?.([...readFiles].sort());
          }
          if (message.subtype === "success") {
            input.events.onCompleted(redact(message.result || assembled));
          } else {
            input.events.onFailed(
              "CLAUDE_UNAVAILABLE",
              message.errors?.join("; ") || `Claude run failed (${message.subtype}).`,
            );
          }
          return;
        }
      }

      if (readFiles.size > 0) input.events.onRepoAccess?.([...readFiles].sort());
      if (assembled) {
        input.events.onCompleted(redact(assembled));
      } else {
        input.events.onFailed(
          "CLAUDE_UNAVAILABLE",
          "Claude ended the run without producing an answer.",
        );
      }
    } catch (error) {
      if (abort.signal.aborted) {
        input.events.onFailed("REQUEST_CANCELLED", "Cancelled");
        return;
      }
      input.events.onFailed(
        "CLAUDE_UNAVAILABLE",
        error instanceof Error ? error.message : "Claude run failed",
      );
    }
  })();

  return { cancel: () => abort.abort() };
}

export interface ClaudeRunHandle {
  cancel: () => void;
}

/** Maps SDK-reported errors onto stable failure codes for the room. */
function failureCodeFor(error: string): string {
  switch (error) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
      return "CLAUDE_NOT_AUTHENTICATED";
    case "billing_error":
      return "CLAUDE_BILLING";
    case "rate_limit":
    case "overloaded":
      return "CLAUDE_RATE_LIMITED";
    default:
      return "CLAUDE_UNAVAILABLE";
  }
}

export function runDiscussionOnly(input: {
  content: string;
  cwd: string | null;
  events: ClaudeRunEvents;
}): ClaudeRunHandle {
  const abort = new AbortController();

  void (async () => {
    let assembled = "";
    let started = false;
    try {
      const response = query({
        prompt: input.content,
        options: {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          abortController: abort,
          includePartialMessages: true,
          // Without a prompt of its own the bare, tool-less session answers
          // oddly (it echoed the question back when asked to read a file).
          // This states the situation so it can decline cleanly instead.
          systemPrompt: DISCUSSION_ONLY_PROMPT,
          // Discussion only — see the gate list above; all four are required.
          tools: [],
          settingSources: [],
          allowedTools: [],
          canUseTool: async (toolName) => ({
            behavior: "deny",
            message: `ClaudeRooms: '${toolName}' is not permitted in a discussion-only request.`,
          }),
        },
      });

      for await (const message of response) {
        if (!started) {
          started = true;
          input.events.onStarted();
        }

        if (message.type === "stream_event") {
          const event = message.event;
          // Token-level text deltas; anything else (thinking, tool events)
          // is deliberately not forwarded to the room.
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta" &&
            event.delta.text
          ) {
            assembled += event.delta.text;
            input.events.onDelta(event.delta.text);
          }
          continue;
        }

        if (message.type === "assistant" && message.error) {
          input.events.onFailed(
            failureCodeFor(message.error),
            `Claude could not answer (${message.error}).`,
          );
          return;
        }

        if (message.type === "result") {
          if (message.subtype === "success") {
            // `result` is authoritative; fall back to what we streamed.
            input.events.onCompleted(message.result || assembled);
          } else {
            input.events.onFailed(
              "CLAUDE_UNAVAILABLE",
              message.errors?.join("; ") || `Claude run failed (${message.subtype}).`,
            );
          }
          return;
        }
      }

      // Stream ended without a result message.
      if (assembled) {
        input.events.onCompleted(assembled);
      } else {
        input.events.onFailed(
          "CLAUDE_UNAVAILABLE",
          "Claude ended the run without producing an answer.",
        );
      }
    } catch (error) {
      if (abort.signal.aborted) {
        input.events.onFailed("REQUEST_CANCELLED", "Cancelled");
        return;
      }
      input.events.onFailed(
        "CLAUDE_UNAVAILABLE",
        error instanceof Error ? error.message : "Claude run failed",
      );
    }
  })();

  return { cancel: () => abort.abort() };
}
