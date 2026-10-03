# Pi Everyday

Pi Everyday provides small, additive conveniences that leave host behavior intact when a convenience is unavailable.

## Language

**Path Link**:
A display-only link from an existing local path to its containing folder, or from a local directory to itself.
_Avoid_: File link, clickable path

**Path Rendering**:
The conversion of supported assistant-display Markdown into Markdown containing Path Links without changing session history or model context.
_Avoid_: Path rewriting, message mutation

**Directory Opening**:
An action that opens the containing directory of an existing local file, or opens an existing local directory itself, while preserving the original message.
_Avoid_: File opening, Path Rendering

**Image Request**:
A user's request for an image through Codex's built-in image generation tool, fulfilled through one or more Image Runs. Its creative instructions and reference inputs remain the user's unless changes are explicitly authorized.
_Avoid_: Image job, generation session

**Image Run**:
One Codex execution attempting to produce an image through the built-in image generation tool. Whether an image was produced and what the execution evidence establishes are separate facts.
_Avoid_: Image request, completed image

**Rollout**:
The Codex event log used as evidence of an Image Run's tool behavior and artifact provenance.
_Avoid_: Trace, transcript

**Artifact Custody**:
The preservation and delivery of every recovered generated image with its originating Image Run identified. Original artifacts remain intact, and additional valid results are disclosed rather than silently selected or discarded.
_Avoid_: File move, automatic image selection
