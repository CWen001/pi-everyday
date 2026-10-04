---
name: codex-image-gen
description: Generate or edit images through your Codex subscription, with recovery and bounded retries.
disable-model-invocation: true
---

# Codex Image Gen

Use the local Codex subscription and built-in image_gen. The user chooses artistic quality; the runner checks technical validity and reports execution evidence, not hard tool isolation.

## Steps

1. Collect the user's non-empty creative prompt, ordered optional reference-image paths, and optional output-file path. Preserve the prompt and reference intent; add no creative requirements.

2. Pass the prompt on stdin to [`scripts/run.mjs`](scripts/run.mjs). Repeat `--image` for each supplied reference, within Codex's native limit. Omit unused options.

   ```bash
   node <skill-directory>/scripts/run.mjs [--image <path> ...] [--output <path>] [--max-submissions <1|2|3>]
   ```

   One Image Request defaults to an allowance of three observable image-tool submissions, including the first, without further confirmation. Honor a requested lower allowance with `--max-submissions`; use `1` for a single-call request or smoke test with outer regeneration disabled. The runner owns continuation: it waits, recovers known results, then retries eligible failures. Counts come from native call identities; Codex's internal HTTP retries and backend charging are outside this observable allowance. Waiting and saving are not new generations. Do not relaunch the runner merely because a tool wrapper returned a running process; wait for that same process to finish. Do not add an outer retry loop or reroll for aesthetics. For an explicit batch, invoke once per requested image and preserve completed results.

3. Read the returned JSON even on a nonzero exit. Present **every** entry in `images`, in attempt order, displaying each image if supported or providing its accessible path. Explain which came from a retry or late recovery. `path` is only a compatibility alias, not a selected best image.

   Report `status`, relevant `runs[].check` warnings or violations, and reference usage. A damaged independent record can leave trusted images available; conflicting artifact identities remain excluded. Generation-count uncertainty stops new submissions while preserving recoverable results. An incomplete check can accompany a valid image; a partial/failed request may still have useful images. A confirmed violation stops automatic retries but does not erase completed images. Never describe an opaque exec wrapper as fully audited.

4. Completion means the runner has terminated and every reported image exists. Keep original Codex artifacts and existing output files intact. For failures, report the actual error and `diagnostic` path; `runs` also identify the originating Rollout and recoverable artifact sources. Never print raw Rollout contents or base64 image data. A delivery failure calls for recovering the existing image, not generating another.

## Maintenance and compatibility

Consult this section when Codex is incompatible or when maintaining the skill, not on every image request.

- Check `codex --version` and the current upstream [tool guidance](https://github.com/openai/codex/blob/main/codex-rs/ext/image-generation/imagegen_description.md) and [tool contract](https://github.com/openai/codex/blob/main/codex-rs/ext/image-generation/src/tool.rs). Follow the latest applicable guidance while reporting the actual installed version's capabilities. Reference limits and image model routing belong to Codex, not this wrapper.
- Use the CLI's existing installation/update mechanism when a newer compatible version is needed; verify and record the version after updating. For an npm-managed Codex, this is `npm install -g @openai/codex@latest`. Do not switch installation methods or force an upgrade on every run.
- Preflight repair before any generation may be followed by the same request. Once an Image Run exists, inspect its outcome before further action and keep the request's shared generation budget; do not reset it by blindly rerunning this command.
- Inherit native reference handling, necessary view_image calls, same-task waits and supported transparency options. The runner attaches references and supplies their paths; Codex follows its native guidance and can use the attachments if its filesystem bridge cannot read them. Do not substitute another provider or Images API.
