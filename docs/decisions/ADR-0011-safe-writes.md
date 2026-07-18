# ADR-0011: Safe writes — Claude proposes, the host executes

## Status

Accepted (2026-07-18)

## Context

Through Milestone 6 Claude can read the repository (host-approved) but never
change it. Milestone 7 lets it make a change — the most dangerous capability so
far, because it touches the host's real working tree. The acceptance is
explicit: **nothing executes before approval; approval binds to one proposal;
rejected actions never run; results are reported accurately.**

The obvious path — give Claude the SDK `Write`/`Edit` tools behind a policy, as
we did for `Read`/`Glob` — is wrong here. With read tools, host approval grants
a capability and Claude then uses it freely; a mistaken read is recoverable.
A write is not: once Claude's tool call lands, the file is already changed, so
"approval before execution" cannot be guaranteed if Claude holds the pen.

## Decision

1. **Claude proposes; it never writes.** A write is an **ActionProposal**: a
   first-class object `{ path (repo-relative), content, rationale }` that Claude
   produces with read-only tools. Claude is given `Read`/`Glob` (gated by
   `RepoAccessPolicy`, as in M5) and a single custom `propose_write` tool that
   only records the proposal — it changes nothing on disk.

2. **The host executes, once, after approval.** The proposal is parked
   `awaiting_approval` (the M5 flow). The host sees the exact path and content
   and approves or rejects. **Only on approval** does the host _process_ run the
   write, via `applyWrite` under `RepoWritePolicy`. Rejected proposals never
   touch disk. Approval is a one-way transition bound to that proposal id
   (re-approving, or approving a rejected one, is `INVALID_TRANSITION`, exactly
   like M5).

3. **`RepoWritePolicy` gates the path, always.** Containment is checked on the
   REAL parent directory (so a `../` escape or a symlinked directory is rejected
   even for a file that does not exist yet); the credential/denied-directory
   deny-list is shared verbatim with the read policy; writing _through_ a
   symlink is refused; directories are never created; content over 1 MiB is
   refused. `applyWrite` re-checks immediately before writing — the check and
   the write are never separated by trust.

4. **The scope is one file.** This milestone is create-or-overwrite of a single
   repository text file. Not: delete, rename, `chmod`, multi-file batches, or
   any command execution (`Bash` stays denied). Those are separate proposals
   with their own policies, later.

5. **The room sees the truth.** The written path (repo-relative) is broadcast
   as a durable audit event and rendered as a work card, alongside the outcome.
   A refused or failed write is reported as such — never a silent success.

## Consequences

- "Approval before execution" is structural, not a promise: Claude has no write
  tool, so there is no code path from an un-approved proposal to a changed file.
- The host reviews the actual content, not a paraphrase, and the change lands in
  the working tree where `git diff` / revert is one command away.
- The write policy is unit-testable in isolation (it reads no content, only
  rules on paths + size) — shipped and mutation-checked in step 1 before any
  flow can call it, the same order repo-access followed in M5.
- A future step can add per-proposal richer review (diff view) or more action
  types on the same ActionProposal spine without reopening this decision.

## Alternatives considered

- **Give Claude `Write`/`Edit` behind `canUseTool` + a policy.** Symmetric with
  reads and less code, but it puts the write in Claude's hands: the file is
  changed the instant the tool runs, so approval-before-execution is
  unenforceable. Rejected — it fails the milestone's core guarantee.
- **Apply writes to a staging copy, let the host promote them.** Safer diffing,
  but a whole shadow tree and promotion flow for a gain the working tree +
  `git` already give. Revisit if proposals grow beyond single files.
- **Let Claude run `git`/test commands now.** Command execution is a much larger
  surface (arbitrary side effects, network); it needs its own policy and ADR and
  is out of scope for the first safe write.
