# Pi + Herdr ephemeral delegation research

_Research snapshot: 2026-08-16 UTC. Local installs inspected: Pi 0.84.2 and Herdr 0.8.0._

## Verdict

Herdr officially establishes the primitives and documents the core `create/split → agent start → agent prompt --wait → agent read` sequence, but a temporary, no-residue Pi delegate that always closes its topology is still a custom composition. There is no native `herdr delegate` or `agent close`; cleanup is `pane close`, `tab close`, or `workspace close`. Third-party Pi packages add materially different persistence and cleanup policies.

## Official references

### Pi subagent example

Pi's example is an extension, not a built-in child-session primitive. It launches a separate Pi process with `--mode json -p --no-session`, optionally restricts tools, parses JSON events, propagates abort, and deletes temporary prompt storage. Its reusable pattern is: fresh process, no persisted session, explicit capabilities, bounded prompt, structured result, and cleanup.

Sources: [example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent), [extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).

### Pi handoff example

`/handoff` is replacement-session UX rather than parallel delegation. It turns the active conversation into a concise, editable, self-contained prompt and switches sessions. The reusable lesson is to transfer a focused capsule instead of a transcript.

Source: [handoff example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/handoff.ts).

### Herdr automation

Herdr separates topology from agent lifecycle: create a pane, start an agent in its ready shell, prompt and wait for a settled state, then read the result. Lifecycle state is a wake-up signal rather than proof of a uniquely correlated turn. `blocked` needs handling and `unknown` does not prove completion. Cleanup remains caller policy.

Sources: [agent automation](https://herdr.dev/docs/agent-automation/), [agents](https://herdr.dev/docs/agents/), [CLI reference](https://herdr.dev/docs/cli-reference/).

## Community landscape

- [`@andrewjacop/pi-herdr`](https://github.com/AndrewJacop/pi-herdr) is the closest thin packaged wrapper, including a one-shot delegate with close-on-success behavior.
- [`pi-herdr-agents`](https://github.com/giuseppecrj/pi-herdr-agents) adds async children, workflows, worktrees, and side sessions.
- [`@maxedapps/pi-subagents-herdr`](https://github.com/maxedapps/pi-subagents-herdr) emphasizes persisted results, journals, recovery, and conservative cleanup.
- [`pi-subagents`](https://github.com/nicobailon/pi-subagents) is a broad delegation framework rather than a native Herdr-pane recipe.
- [Herdr's agent-to-agent discussion](https://github.com/herdrdev/herdr/discussions/741) shows that a higher-level delegation protocol is not yet settled.

These projects demonstrate demand, but most are intentionally heavier than bounded ephemeral delegation. Adoption signals are not correctness guarantees, and behavior can drift with Pi and Herdr releases; installed documentation and `--help` remain authoritative.

## Recommendation

For vanilla Pi, compose the official primitives:

1. Create and retain the ID of one temporary no-focus pane.
2. Start Pi with `--no-session --no-skills` and the minimum required tools. `--no-skills` prevents a delegated research skill from recursively delegating.
3. Send a task capsule containing Task, Context, Sources, Boundaries, and Return.
4. Wait according to dependencies, handle blocked/error/timeout states, and collect the result.
5. Close every owned child and pane on every exit path.
6. Keep readers in the shared checkout; use isolated worktrees only for explicitly requested parallel writers.

This keeps orchestration as policy rather than a new framework.
