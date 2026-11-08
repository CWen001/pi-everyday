# Pi Everyday

Pi Everyday provides small, additive conveniences that leave host behavior intact when a convenience is unavailable.

## Language

**Editor Context**:
The editor's current file and selected text made available to a Pi conversation, including selection locations and whether the document has unsaved changes.
_Avoid_: Project context, file contents on disk

**Context Attachment**:
Editor Context included with a user's message when automatic sharing is enabled for that Pi session. Editor changes alone do not send a message to the model.
_Avoid_: Continuous streaming, selection submission

**Path Link**:
A display-only link to the original existing local file or directory URI. The link preserves target identity rather than encoding an opening action.
_Avoid_: Directory-only link, opening action

**Folder Companion**:
A separate `folder` Path Link immediately after a regular file's Path Link. Its target is the containing directory URI. Directory links have no companion.
_Avoid_: Modifier intent, replacement file target

**Path Rendering**:
The conversion of supported assistant-display Markdown into Markdown containing Path Links and Folder Companions without changing session history or model context. Original file-link labels and URI bytes remain intact. Repeated rendering does not duplicate companions.
_Avoid_: Path rewriting, message mutation

**Target Opening**:
An action that opens the local file or directory identified by the activated URI. The bundled native Herdr plugin uses Ctrl-click on macOS and Windows. Activating a Folder Companion opens its directory through the same action. The direct WezTerm integration also supports Cmd-click on macOS.
_Avoid_: Directory Opening, Path Rendering

**Directory Opening**:
An action that resolves an existing file to its containing directory, or opens an existing local directory itself. The direct WezTerm integration selects this action when Alt/Option is held during activation. It reads current keyboard modifiers before resolving the original URI, not a click-time snapshot. No pending intent survives the handler.
_Avoid_: Target Opening, Path Rendering

Unmodified mouse bindings remain unchanged. The shared resolver retains its `target` and `folder` intents and UNC support. The native Herdr adapter accepts only local URIs and always requests `target`; the clicked URI selects the file or folder without modifier sampling. Direct WezTerm handling retains both intents. Failed validation, modifier reads, or resolution cancel the action rather than opening a different target. Native process acceptance does not establish visible OS opening.

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
