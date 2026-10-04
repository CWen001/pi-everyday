# Local editor status: minimal implementation

## Scope

The author authorized a local companion fix via `/implement`, following the narrowed specification in `.scratch/editor-context/spec.md`. The companion remains a personal Pi extension. Package entry points, VS Code Bridge, Herdr, global settings and publishing configuration remain unchanged.

Review baseline: `4ad9951109bee255f2ee4dd071df7378da52a9ee`.

## Change

`local-editor-status.patch` records the exact change to `~/.pi/agent/extensions/pi-vscode-context.ts`:

- Clear this extension's native status at session start.
- Show filename/selection status after accepted Editor Context arrives.
- Show the existing disconnect/reconnecting notice only after this session has received valid context.
- Preserve discovery, transport, retry behavior, context attachment, file tools and above-input widget cleanup.

This fixes both the initial phantom connecting indicator and a disconnect indicator caused by a rejected/stale endpoint before any valid context. Discovery still retries as before; this is a visual fix, not a polling or security redesign.

Local source SHA-256:

| Source | SHA-256 |
| --- | --- |
| Before this implementation | `129555b280df64194cd03084604a47b833f948d0869c9f2be8ea851449788729` |
| After this implementation | `e89d892fe077f022ff0a149101a3dc790d83d4f8c7d24edc47bdde8d6e0b3b9b` |

The pre-change local source is backed up at `.scratch/editor-context/companion.before-implementation.ts`. The patch is relative to that existing macOS companion, which already contains discovery and native-status changes. It is not an installer or a full replacement for the upstream VS Code extension. Verify the source hash before any future application; the local copy is already patched.

## Verification

Run the standalone macOS probe from this checkout:

```sh
node --experimental-strip-types docs/research/check-editor-experience.mjs
```

An optional absolute companion path selects another source under test. The probe uses a temporary HOME, synthetic editor data, independent extension instances, and real loopback sockets; it preserves actual editor content and settings.

- RED: pre-change companion failed the no-matching-editor quiet-status assertion (exit 1).
- GREEN: changed companion passes the experience probe (exit 0).
- Same-project siblings can start/stop while the writer continues receiving fresh selections. Each instance attaches its own initial context.
- Clearing selection updates native status and subsequent attachment; draft text remains intact and editor changes send no model messages.
- Closing the simulated editor invalidates current context. Previously connected sessions retain a brief disconnect notice; rejected contexts in never-connected sessions remain visually quiet.
- Existing discovery, Chinese-path, explicit-port, reconnect, changed-port, shutdown and ambiguous/mismatched-workspace checks pass.
- The local TypeScript source passes strict checking using the repository's installed Pi declarations and compiler settings (`.scratch/editor-context/tsconfig.local.json`).

Logs are local artifacts under `.scratch/editor-context/`: `experience-red.log` and `experience-green.log`. The standalone probe remains outside `npm test` because it requires the separately installed local companion and macOS workspace facilities.

Final checks passed: `npm run check` (typechecking and 78 package tests), strict local-companion typechecking, the original personal `vscode-herdr.test.mjs`, and the new experience probe. These checks establish the listed synthetic behavior and package baseline; real-host acceptance remains below.

## Independent review

Two parallel, fresh, read-only Pi reviewer processes used `openai-codex/gpt-6-astra`. Reviewed range: `4ad9951109bee255f2ee4dd071df7378da52a9ee...aae6a7a`. Reviewers inspected the local before/after sources as well as the committed patch. Neither reviewer ran tests or modified files; the test evidence above was collected separately.

### Standards

No blockers, documented violations, or actionable smell findings. The local flag keeps status behavior additive, package runtime stays unchanged, and no new abstraction is warranted. Real-host visual and session behavior remains pending.

### Spec

No blocking deviations, missing local implementation requirements, unrequested scope growth, or incorrect changed behavior identified. Actual Herdr reattachment, real Pi processes, rendering/reload, Windows, and general Pi use after closing VS Code remain manual acceptance items rather than claims established by the probe.

Summary: Standards 0 actionable findings; Spec 0 code findings, real-host acceptance pending. Full independent responses and event traces are retained as `.scratch/editor-context/review-local-{standards,spec}.{md,jsonl}`.

## Remaining acceptance

The multi-instance test runs in one process. Actual Pi processes, Herdr reattachment between VS Code and WezTerm, narrow-terminal rendering, and Windows require real-host verification. No such acceptance is inferred from the synthetic tests.

After the current turn, use `/reload` (or start a new Pi) to load the patched local extension. Check native status placement and the exact VS Code → Herdr → Pi → WezTerm workflow. This implementation does not reload or terminate an existing user session.

The existing Bridge sharing-pause/authentication/broadcast limitations remain documented in `editor-context-compatibility.md`; the narrow visual fix makes no new sharing-control guarantee.
