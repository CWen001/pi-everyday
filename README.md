# pi-everyday

Small, additive conveniences for [Pi](https://pi.dev):

- Show remaining OpenAI Codex subscription usage.
- Keep old images out of future model requests without changing session history.
- Turn existing local paths in assistant output into Path Links.
- Generate one audited image through Codex's built-in `image_gen` tool.
- Carry an opt-in recipe for temporary Pi delegation through Herdr.

This package is primarily maintained for personal use. Public use is welcome, but maintenance and compatibility are best effort.

## Quick start

Install globally:

```bash
pi install npm:pi-everyday
```

Start Pi normally. The extensions load automatically.

To try the package for one session without installing it:

```bash
pi -e npm:pi-everyday
```

Pi packages execute with the same system access as Pi. Review the source before installing packages you do not trust.

## Features

### OpenAI usage status

When Pi has an `openai-codex` OAuth login, a compact status shows the remaining primary and secondary subscription windows. It refreshes after turns with a five-minute cooldown and does not replace Pi's footer.

If the internal OpenAI usage endpoint is unavailable or changes, the status stays silent.

### Image context pruning

Images introduced during the current turn remain available to the model. On later turns, their image data is replaced only in the outbound model context with a short instruction to re-read the original path or request the image again.

Session history, text, tool calls, and saved JSONL remain unchanged. An old image without a reusable path must be attached again for further visual analysis.

### Path Links

Path Rendering turns supported existing local paths into terminal links:

- A file links to its containing directory.
- A directory links to itself.
- Inline-code paths, standalone path lines, and existing non-image Markdown links are supported.
- Relative, `~/`, and absolute paths work in normal assistant output.
- Custom Markdown views receive absolute Path Links only because their working directory is unknown.

For example, Pi can render generic paths such as `./output/result.txt`, `~/project`, or `/path/to/project` as actions when they exist. Missing paths, URLs, Markdown images, and every fenced block remain unchanged.

Path Rendering affects display only. It does not alter session history or model context.

### Codex image generation

Run the skill in Pi:

```text
/skill:codex-image-gen
```

Provide a prompt and, optionally, one reference image and an output such as `./output/image.png`. The skill runs the local `codex` command in a constrained Image Run, audits its Rollout, and transfers exactly one verified artifact.

There are no automatic retries, fallback providers, or additional image requests.

### Ephemeral delegation recipe

[`recipes/ephemeral-delegation/`](recipes/ephemeral-delegation/) contains an inactive, manually installed global rule for bounded research and review workers in Herdr. Read its README before copying it into Pi's global configuration. It is packaged for portability but does not load automatically.

## Privacy and security

- The package includes no telemetry.
- Usage status uses the active OpenAI OAuth token only for an in-memory request to the internal usage endpoint. It does not persist the token or account identifier.
- Path Rendering checks whether candidate paths exist and whether they are files or directories. It does not read file contents or send paths to a remote service.
- Image context pruning changes only the transient outbound model request. Saved session history is not rewritten.
- An Image Run sends its prompt and optional reference image to OpenAI through the locally installed Codex CLI and consumes the account's image allowance.
- Codex owns its login and keeps its normal session records under `CODEX_HOME`. The package does not read or store Codex credentials.
- Image failure diagnostics and Codex records can contain prompts and local paths. Review them before sharing.

Default generated images and diagnostics use `.scratch/`, which should remain excluded from version control.

## Compatibility and limitations

- Pi 0.84.1 or newer.
- Node.js 22.19.0 or newer.
- macOS, Windows, and Linux.
- Path Links require a terminal that supports OSC 8 hyperlinks and `file://` URI handling.
- Some terminals capture mouse input and require their hyperlink modifier while clicking.
- Usage status depends on an undocumented OpenAI endpoint and can stop working without notice.
- Image generation requires a compatible, authenticated local Codex CLI.
- Generated images and diagnostics remain after package removal until deleted manually.

Automated checks run on macOS, Windows, and Linux. Pointer behavior can still vary by terminal.

## Troubleshooting

### Path Links render but do not open

Confirm that the terminal enables OSC 8 hyperlinks and routes `file://` URIs to the operating system. Try the terminal's normal hyperlink modifier while clicking.

### Usage status is absent

Confirm that Pi has an active `openai-codex` OAuth login. Endpoint failures intentionally remain silent.

### Image generation fails before starting

Confirm that the local CLI is available and authenticated:

```bash
codex --version
codex login
```

Failure output includes the diagnostic location when one can be written. Diagnostics may contain prompts and local paths.

For reproducible defects, open the package's configured issue tracker:

```bash
npm bugs pi-everyday
```

## Update and remove

Update this package:

```bash
pi update npm:pi-everyday
```

Update all installed Pi packages:

```bash
pi update --extensions
```

Remove it:

```bash
pi remove npm:pi-everyday
```

Removing the package stops its extensions but does not delete generated images or diagnostics.

## Development

```bash
git clone <repository-url>
cd pi-everyday
npm install
npm run check
pi -e .
```

Do not commit credentials, generated images, diagnostics, local paths, or session logs.

Releases are published by GitHub Actions from matching `v*` tags through npm trusted publishing. Local npm tokens are not used for releases.

## License

MIT
