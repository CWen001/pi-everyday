# pi-everyday

Lightweight, additive conveniences for [Pi](https://pi.dev):

- Shows remaining OpenAI Codex subscription usage as a small extension status.
- Turns existing local file paths in finalized assistant messages into links to their containing folders.

## Design promises

`pi-everyday` is deliberately additive:

- It does not replace Pi's footer or change Pi settings.
- It does not write configuration, cache, credentials, or usage data.
- It has no runtime dependencies beyond Pi and Node.js.
- Missing authentication, network failures, and invalid paths stay silent.
- Removing the package removes all of its behavior.

## Install

```bash
pi install npm:pi-everyday
```

To try a local checkout without installing it:

```bash
pi -e /path/to/pi-everyday
```

## OpenAI usage status

When Pi has an `openai-codex` OAuth login, the package requests subscription usage at startup and refreshes after turns with a five-minute cooldown. A compact status such as `quota 82%/5h 60%/7d` is added without replacing Pi's default footer.

The usage endpoint is an internal ChatGPT endpoint and may change without notice. The access token and account identifier are used only for the request and are never persisted by this package.

## Local file links

Only paths that currently resolve to files are linked. Directories, missing paths, URLs, fenced code blocks, and existing Markdown links are unchanged. The transformation is display-only and does not alter session history or model context.

Click handling belongs to Pi and the terminal:

- Pi fullscreen mode supports a direct click.
- Regular terminal mode may require the terminal's hyperlink modifier, such as Shift+click in WezTerm.
- Windows terminals may use Ctrl+click.

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
