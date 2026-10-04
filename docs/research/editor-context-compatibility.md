# Editor Context protocol compatibility

## Current integration

Pi Everyday implements Editor Context against VS Code Pi Agent Bridge 0.0.3. Its installation setup and runtime diagnostics are documented in the README; the Module decision is recorded in [ADR-0002](../adr/0002-optional-editor-context.md).

The Bridge protocol has sharing-control limitations that cannot be corrected by Pi-side workspace validation. The integration retains those limitations rather than claiming stronger privacy guarantees. They remain distinct from installation and connection correctness.

## Reviewed sources

- Dependency: `zenyui.vscode-pi-bridge` 0.0.3, MIT licensed, copyright 2026 zenyui.
- Upstream revision: `ec553e0699b9a93b143a52b9066621156e6ce740`.
- [Extension source](https://github.com/zenyui/vscode-pi/blob/ec553e0699b9a93b143a52b9066621156e6ce740/src/extension.ts).
- [IPC source](https://github.com/zenyui/vscode-pi/blob/ec553e0699b9a93b143a52b9066621156e6ce740/src/ipc.ts).

The synthetic protocol probe verifies both source hashes before executing the pinned upstream TypeScript. Changed sources require a fresh review. It does not launch a VS Code extension host or prove terminal reattachment.

## Protocol findings

| Finding | Source | Synthetic probe evidence |
| --- | --- | --- |
| A new connection receives context while sharing is paused. | The initial connection sends context unconditionally; the enabled check applies to later pushes only. | After the real toggle handler sets `enabled=false`, a second loopback client still receives the synthetic selection. |
| Existing clients receive no pause/invalidation state. | The disabled branch emits no update; IPC has no sharing-state signal. | The first client receives no additional message during a 200 ms observation. Source inspection establishes the disabled branch behavior; bounded observation alone is not a guarantee about all future timing. |
| Local clients receive context without authenticating. | IPC accepts a connection and invokes its initial-context handler directly. | Both clients obtain context without sending requests or credentials. |
| Send Selection broadcasts while sharing is paused. | The command has no enabled guard and broadcasts to all clients. | Both clients receive an inject message after the real Send Selection handler runs. |

A Pi client cannot distinguish an unchanged editor from a paused sender through this protocol. A timeout would only guess; reconnecting receives another snapshot while paused. Workspace checks reject unrelated projects but are not endpoint authentication.

## Reproduce

Run from the development checkout after installing dependencies:

```sh
git clone https://github.com/zenyui/vscode-pi.git .scratch/editor-context/upstream-vscode-pi
git -C .scratch/editor-context/upstream-vscode-pi checkout ec553e0699b9a93b143a52b9066621156e6ce740
node docs/research/check-editor-bridge.mjs .scratch/editor-context/upstream-vscode-pi
```

Reuse an existing checkout when present. The probe uses Node core modules, the development TypeScript dependency, synthetic editor state, and ephemeral loopback sockets. It closes its clients and listener. Its VM loader is a module-loading convenience, not a security sandbox.

Expected on the reviewed revision: `contextDeliveredWhilePaused: true`, `messagesDuringPause: []`, and two clients receiving Send Selection. Exit code 1 intentionally indicates that stronger sharing controls are unmet, not that package setup or its normal regression suite failed.

The probe contains no real editor text or credentials and stays outside published runtime files and normal tests.

## Acceptance and further work

Normal package tests cover context attachment, independent same-project sessions, reconnect, deadlines, native status, cross-project rejection, and macOS/Windows workspace discovery. Setup tests cover verified cleanup, JSONC preservation, custom-file preservation, and the first real Pi resource load after setup. Local diagnostics report connection reasons without becoming model messages.

Real VS Code → Herdr → Pi → WezTerm reattachment and visual rendering still require per-machine checks. Automated protocol probes and loopback tests do not establish those GUI behaviors.

Stronger sharing guarantees require changes to the editor-side Bridge: enabled-aware initial snapshots, explicit pause/invalidation state, and consistent command handling. Authentication and broadcast routing require separate design and review.
