# Delegation

Use native Pi and Herdr only; add no delegation package.

## 1. Bound

Keep implementation and verification in the main session. Delegate a loaded skill's required background/parallel work, or an independent research/review task when isolation materially protects the main context. Parallel writers require explicit user direction.

A child is bounded when it has one independent deliverable and the main session can proceed or wait without overlapping ownership.

## 2. Dispatch

When `HERDR_ENV=1`, read the Herdr skill and use its CLI workflow, with the installed CLI as syntax authority. Create a no-focus sibling in the current working directory and retain every returned ID. Outside Herdr, complete the work sequentially in the main session.

Launch each child with `pi --no-session --no-skills` and only the tools its deliverable needs. The child completes its capsule directly; only the main session delegates. Readers share the checkout and may write only a named artifact. User-authorized writers receive separate, non-overlapping worktrees.

Send a **task capsule**:

- **Task:** one outcome and deliverable.
- **Context:** confirmed decisions and constraints the child cannot cheaply discover.
- **Sources:** paths, commands, commits, specs, issues, or URLs; prefer references over copied content.
- **Boundaries:** allowed reads/writes and explicit exclusions.
- **Return:** format, length, evidence, and uncertainty requirements.

The capsule is complete when the child can act without the parent transcript or questions to the user.

## 3. Collect

Wait when the main task depends on the result; otherwise continue only non-overlapping work. The child makes a best effort, reports assumptions or missing information, and receives at most one follow-up.

Treat child output as evidence. The main session verifies every result that affects implementation. Collection is complete when the required response or artifact is received and its consequential claims are checked.

## 4. Reap

On success, failure, timeout, or abort, terminate every child and close every pane or session created for it. Retain only requested deliverables. Reaping is complete when no owned child process, pane, or session remains.
