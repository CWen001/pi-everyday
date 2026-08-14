# pi-everyday

Lightweight, additive conveniences for [Pi](https://pi.dev):

- Shows remaining OpenAI Codex subscription usage as a small extension status.
- Removes already-processed images from future model requests while preserving session history.
- Turns existing local file paths in finalized assistant messages into links to their containing folders.
- Generates one image through Codex's built-in `image_gen` tool.

## Design promises

`pi-everyday` is deliberately additive:

- It does not replace Pi's footer or change Pi settings.
- The extensions do not persist credentials or usage data; image context pruning changes only transient model requests, and the image runner never reads credentials.
- The image skill writes only its requested output and failure diagnostics.
- It has no runtime dependencies beyond Pi and Node.js; the optional image skill also requires your local Codex CLI.
- Usage-status and file-link failures stay silent; image-generation failures are reported.
- Removing the package stops its behavior. Generated images and diagnostics remain until you delete them.

## Install

```bash
pi install npm:pi-everyday
```

To try a local checkout without installing it:

```bash
pi -e /path/to/pi-everyday
```

## OpenAI usage status

When Pi has an `openai-codex` OAuth login, the package requests subscription usage at startup and refreshes after turns with a five-minute cooldown. A status such as `5h 82% left (3h 55m) · 7d 60% left (5d 15h)` is added without replacing Pi's default footer.

The usage endpoint is an internal ChatGPT endpoint and may change without notice. The access token and account identifier are used only for the request and are never persisted by this package.

## Image context pruning

Images introduced during the current turn remain available to the model. On later turns, their image data is replaced in the outbound context with a short instruction to re-read the original path or ask for the image again. Text, tool calls, and the session JSONL remain unchanged.

This keeps image-heavy sessions responsive. A historical image without a reusable file path must be reattached when deeper visual analysis is needed.

## Local file links

Only paths that currently resolve to files are linked. Existing relative Markdown file links are normalized to `file://` links for their containing folders. Directories, missing paths, URLs, Markdown image targets, and fenced code blocks are unchanged. The transformation is display-only and does not alter session history or model context.

Click handling belongs to Pi and the terminal:

- Pi fullscreen mode supports a direct click.
- Regular terminal mode may require the terminal's hyperlink modifier, such as Shift+click in WezTerm.
- Windows terminals may use Ctrl+click.

## Codex image generation

Run `/skill:codex-image-gen` in Pi with a prompt, optionally one reference image and an output path. The skill runs your local `codex` command with user configuration ignored, non-image features disabled, and a read-only sandbox, then audits the recorded run before moving the generated image.

Codex handles its own login; this package never reads or stores subscription credentials. Prompts and reference images are sent to OpenAI and consume your Codex image allowance. Codex also keeps its normal local session records under `CODEX_HOME`; failed audits can leave generated artifacts there.

Default outputs and failure diagnostics go under `.scratch/`, which is git-ignored. Diagnostics and Codex session records can contain prompts and local paths, so do not share them blindly.

## Compatibility

- Pi 0.84.1 or newer
- Node.js 22.19.0 or newer
- macOS, Windows, and Linux

Automated tests run on all three operating systems. Real pointer interaction is currently verified on macOS; terminal gestures can vary by terminal configuration.

## Development

```bash
npm install
npm run check
pi -e .
```

## License

MIT
