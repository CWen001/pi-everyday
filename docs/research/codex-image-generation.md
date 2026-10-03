# Codex image generation: official subscription path

## Conclusion

Codex supports image generation through its built-in `image_gen` tool when signed in with ChatGPT. This is the preferred path and does not require `OPENAI_API_KEY`. The API/CLI fallback is a separate, usage-billed path and should only be used when explicitly requested.

This machine is correctly configured for the subscription path:

- `codex login status` reports `Logged in using ChatGPT`.
- `codex features list` reports `image_generation stable true`.

`codex exec --image <FILE>` attaches an input/reference image; it is not an output-generation command. Image output is produced by the agent calling built-in `image_gen` during `codex exec`.

## Current built-in interface

OpenAI's Codex implementation exposes the namespaced image tool with these inputs:

- `prompt`
- optional `referenced_image_paths` (up to five)
- optional `num_last_images_to_include` (one to five)

The implementation currently uses `gpt-image-2`, saves a completed artifact under Codex's generated-images directory, and records an `image_gen.generation` completion item containing `savedPath`.

## Local failure diagnosis

The provider call succeeded. Codex generated and saved the image, but the local fail-closed rollout auditor rejected the current Codex serialization:

```text
const result = await tools.image_gen__imagegen({prompt: `...`, referenced_image_paths: []});
generatedImage(result);
```

The auditor previously accepted only JSON object syntax. Supporting this exact current JavaScript form at the existing rollout-audit seam fixes the false failure without weakening the one-image/one-tool provenance checks.

## Primary sources

- OpenAI Codex image-generation skill: https://github.com/openai/skills/blob/main/skills/.system/imagegen/SKILL.md
- OpenAI Codex authentication: https://developers.openai.com/codex/auth
- OpenAI Responses API image-generation tool: https://developers.openai.com/api/docs/guides/tools-image-generation
- OpenAI Codex built-in image tool implementation: https://github.com/openai/codex/blob/main/codex-rs/ext/image-generation/src/tool.rs
