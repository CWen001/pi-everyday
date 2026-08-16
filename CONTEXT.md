# Pi Everyday

Pi Everyday provides small, additive conveniences that leave host behavior intact when a convenience is unavailable.

## Language

**Path Link**:
A display-only link from an existing local path to its containing folder, or from a local directory to itself.
_Avoid_: File link, clickable path

**Path Rendering**:
The conversion of supported assistant-display Markdown into Markdown containing Path Links without changing session history or model context.
_Avoid_: Path rewriting, message mutation

**Image Run**:
One constrained and audited Codex execution that produces exactly one image through the built-in image generation tool.
_Avoid_: Image job, generation session

**Rollout**:
The Codex event log used as evidence of an Image Run's tool behavior and artifact provenance.
_Avoid_: Trace, transcript

**Artifact Custody**:
The validated transfer of an Image Run's generated image from Codex storage to the requested destination while preserving provenance and filesystem safety.
_Avoid_: File move, output copy
