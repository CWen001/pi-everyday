# Ephemeral Pi delegation recipe

This is an opt-in global Pi rule for temporary research and review workers in Herdr. It is documentation only: installing `pi-everyday` does not activate it.

## Ask an agent to install it

Give an agent this folder and say:

> Install this delegation recipe for my global Pi configuration. Read every Markdown file in the folder. Merge the AGENTS.md block without overwriting existing global instructions, copy delegation.md to the referenced location, and verify both files.

## Manual installation

Pi's configuration root is `$PI_CODING_AGENT_DIR` when set, otherwise:

- macOS/Linux: `~/.pi/agent`
- Windows: `%USERPROFILE%\.pi\agent` (also available as `$HOME/.pi/agent` in PowerShell)

1. Copy `delegation.md` to `<Pi config root>/docs/delegation.md`.
2. If `<Pi config root>/AGENTS.md` does not exist, copy this folder's `AGENTS.md` there.
3. If it exists, merge the `## Delegation` section once; preserve all existing instructions.
4. Start a fresh Pi session and confirm the global `AGENTS.md` is listed at startup.

The relative pointer in `AGENTS.md` expects exactly `docs/delegation.md` beneath the Pi configuration root.

## Herdr

The delegated path activates only when Pi runs inside Herdr with `HERDR_ENV=1`. Install Herdr's official Pi integration when available:

```text
herdr integration install pi
```

Use the installed Herdr CLI and documentation as the command authority. Herdr's Windows support is beta; verify it on the target Windows machine. Without Herdr, the rule keeps work sequential in the main Pi session.

## Update

Replace `<Pi config root>/docs/delegation.md` with the newer recipe file. Re-merge `AGENTS.md` only if its pointer changed.

## Remove

Delete the delegation section from the global `AGENTS.md` and remove `<Pi config root>/docs/delegation.md`. Remove only those exact additions.

## Background

See [RESEARCH.md](RESEARCH.md) for the official patterns, community alternatives, and why this recipe stays smaller than a subagent framework.
