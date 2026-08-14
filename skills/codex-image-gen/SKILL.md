---
name: codex-image-gen
description: Generate one image through Codex's built-in image_gen tool.
disable-model-invocation: true
---

# Codex Image Gen

Generate exactly one image through a minimally exposed Codex session. Codex has no built-in-tool allowlist, so the bundled runner audits the recorded run and fails closed rather than claiming hard tool isolation.

## Steps

1. Collect a non-empty image prompt, at most one optional reference-image path, and one optional output-file path. Treat the reference as an edit target or visual reference according to the prompt.

2. Run [`scripts/run.mjs`](scripts/run.mjs) with the prompt on stdin. Add `--image <path>` and `--output <path>` only when supplied.

   ```bash
   node <skill-directory>/scripts/run.mjs [--image <path>] [--output <path>]
   ```

   Invoking this skill authorizes one Codex run. Do not ask for another confirmation, retry, add references, or expand the creative request.

3. On success, report the returned image path, reference-image status, and execution mode. Completion criterion: the runner exits successfully and the reported image exists.

4. On failure, report stderr and any log or rollout paths verbatim. Completion criterion: no failed or unaudited artifact is moved into the workspace.
