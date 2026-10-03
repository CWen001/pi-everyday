# Editor Context compatibility gate

## Outcome

**BLOCKED — feature implementation remains paused.** The reviewed VS Code bridge cannot satisfy the spec's sharing-pause requirement through Pi-side integration alone. No Editor Context runtime has been registered in pi-everyday, and no installed bridge or global configuration was changed during this implementation attempt.

The local tracker is `.scratch/editor-context/spec.md`. It requires the Pi integration to respect VS Code's overall sharing pause and explicitly calls for stopping when the existing bridge cannot meet necessary controls through a small integration. The tracker is local and remains excluded from Git. The author authorized development and a local commit, while installation migration and remote publication remain separately authorized actions.

## Reviewed sources

- Existing dependency: `zenyui.vscode-pi-bridge` 0.0.3, MIT licensed, copyright 2026 zenyui.
- Upstream HEAD checked at `ec553e0699b9a93b143a52b9066621156e6ce740`.
- [Extension source](https://github.com/zenyui/vscode-pi/blob/ec553e0699b9a93b143a52b9066621156e6ce740/src/extension.ts).
- [IPC source](https://github.com/zenyui/vscode-pi/blob/ec553e0699b9a93b143a52b9066621156e6ce740/src/ipc.ts).
- The locally installed compiled extension has the same relevant handlers on inspection. The reproducible probe executes the pinned upstream TypeScript, not a VS Code extension-host instance or the installed bundle.

The probe verifies both source hashes before execution. Source changes require a fresh review. No upstream source is vendored; any later redistribution of upstream implementation must retain its MIT notice.

## Findings

| Finding | Source | Synthetic probe evidence |
| --- | --- | --- |
| A new connection receives context while sharing is paused. | Extension lines 232–233 send context unconditionally; the enabled check at lines 122–124 applies to later pushes only. | After invoking the real toggle handler, `enabled=false`; a second loopback client still receives the synthetic selection. |
| Existing clients receive no pause/invalidation state. | Toggle at lines 257–262 only pushes when enabled. Configuration handler at lines 268–273 leads to the same disabled guard. IPC lines 26–27 expose context/inject and open messages only. | The first client receives no additional message during a 200 ms observation after pause. Source inspection establishes that the disabled branch emits none; the bounded observation alone is not proof about all future timing. |
| Local clients receive context without authenticating. | IPC lines 84–111 accept a connection and call `onConnect` directly. | Both clients obtain context without sending requests or credentials. This finding is limited to processes able to connect to the loopback port. |
| Send Selection broadcasts while sharing is paused. | Extension lines 129–154 have no enabled guard and use broadcast. | Both connected clients receive an inject message after the real Send Selection handler runs. |

The first two findings are the direct implementation blocker. A Pi client cannot distinguish an unchanged editor from a paused sender through this protocol. A stale-context timeout would only guess. Reading VS Code configuration files would duplicate editor configuration semantics and still miss transient changes. Reconnecting also receives context while paused.

The additional authentication and broadcast findings remain separate risks; this probe is not a comprehensive security audit. The user previously chose to retain the installed bridge. That decision is preserved; it does not establish compliance with this new spec.

## Reproduce

Run from the pi-everyday development checkout after installing its development dependencies:

```sh
git clone https://github.com/zenyui/vscode-pi.git .scratch/editor-context/upstream-vscode-pi
git -C .scratch/editor-context/upstream-vscode-pi checkout ec553e0699b9a93b143a52b9066621156e6ce740
node docs/research/check-editor-bridge.mjs .scratch/editor-context/upstream-vscode-pi
```

Reuse an existing checkout when present. The probe uses Node core modules and the existing TypeScript development dependency. It runs reviewed upstream code with synthetic VS Code state, disables companion installation, binds an ephemeral loopback port, and closes its clients and upstream listener. The VM loader is a module-loading convenience, not a security sandbox.

Expected result on this pinned revision: JSON reports `gate: "BLOCKED"`, `contextDeliveredWhilePaused: true`, `messagesDuringPause: []`, and two clients receiving Send Selection. Exit code 1 intentionally marks the compatibility gate as unmet; it is separate from the package's regression suite. Startup/connection/source verification failures are probe errors, not evidence that the gate passed.

The probe deliberately contains no real editor text, credentials or machine-specific paths. It is an opt-in diagnostic, excluded from the normal package test command and published runtime files.

## Minimum next decision

Recommended: authorize a narrowly scoped fix to the **existing** VS Code bridge, ideally contributed upstream, then resume Pi-side integration against the corrected behavior. The pause behavior needs an enabled-aware initial connection, an explicit pause/invalidation signal for existing clients, and consistent handling of commands while paused. Authentication and endpoint verification must be reviewed separately before broadening connection discovery.

An upstream contribution, local development fork, or deployment of a patched extension would need its own agreed delivery and maintenance scope. This attempt did not create a new extension, patch the installation, or replace the user's chosen bridge.

## Verification and remaining work

- Development baseline merged from the current remote 0.3.2 code, preserving the local removal of ephemeral delegation recipes and the Editor Context glossary additions. The README conflict was resolved to current upstream feature descriptions; the merge tree matches the remote baseline.
- macOS synthetic upstream probe: reproduced the blocker above.
- Type checking and targeted existing package tests: passed after baseline reconciliation.
- Pi-side Editor Context TDD: not started; the prerequisite compatibility gate remains blocked.
- Windows automated feature checks and Windows/macOS complete VS Code → Herdr → Pi acceptance: pending. Existing local macOS bridge checks are not package-level cross-platform acceptance.
- Full existing package check on macOS: `npm run check` passed (TypeScript check and 78 tests). This is a baseline regression result; it does not certify the blocked Editor Context feature.
- Independent Standards and Spec reviews: two fresh read-only Codex runs reviewed `git diff f15168d...4b0488c` separately. Both inspected source and recorded evidence; neither independently reran the socket probe.

### Standards

No actionable findings. The probe uses existing dependencies, stays outside published runtime and normal tests, contains synthetic data, and documents its limits. No baseline smell warranted a change. The reviewer also checked script syntax and pinned source hashes.

### Spec

No actionable defect in the prerequisite-only work. The reviewer confirmed that missing pause state and unconditional initial context justify the spec's explicit stop condition. The remaining implementation, migration guidance, feature tests, and Windows/macOS workflow validation are unfinished requirements. The package regression result does not establish feature acceptance.

Summary: Standards 0 actionable findings; Spec 0 actionable findings in the blocker investigation. Editor Context feature acceptance remains blocked.
