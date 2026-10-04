# pi-everyday

Small, additive conveniences for [Pi](https://pi.dev) and OMP:

- Show remaining OpenAI Codex subscription usage.
- Keep old images out of future model requests without changing session history.
- Receive VS Code file/selection context in Pi, including shared Herdr sessions on macOS and Windows.
- Render local Path Links in Pi and open local file links as directories in Windows/macOS WezTerm.
- Generate or edit images through your Codex subscription, with recovery and bounded retries.

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

When Pi or OMP has an `openai-codex` OAuth login, a compact status shows the remaining primary and secondary subscription windows. It refreshes after turns with a five-minute cooldown and does not replace the host's footer.

If the internal OpenAI usage endpoint is unavailable or changes, the status stays silent.

#### Compact OMP status layout

OMP can display the usage status inline with its built-in status fields. To avoid a separate usage row and the stretched line between left and right groups, merge these settings into your OMP configuration:

```yaml
statusLine:
  preset: custom
  leftSegments: [vim, model, mode, path, git, pr, cost, status, token_total, context_pct, session_name]
  rightSegments: []
  separator: pipe
  transparent: true
  contextLine: off
  showHookStatus: false
```

The `status` segment includes extension statuses; `showHookStatus: false` suppresses their duplicate standalone row. All fields stay in one left-aligned group, while any remaining box border follows the last field. OMP may hide fields, including usage, when the terminal is narrow.

This is an optional host-layout preference, not an automatic package setting. Pi Everyday never overwrites your OMP configuration.

### VS Code editor context (Pi)

**Currently available on the Git source; npm 0.3.2 does not include this integration.** Update an existing Git installation with `pi update git:github.com/CWen001/pi-everyday`, then run `/reload` after completing the companion migration below. Keep the Git source for this feature until an npm release includes it.

Use the existing [VS Code Pi Agent Bridge](https://github.com/zenyui/vscode-pi) (`zenyui.vscode-pi-bridge`). Pi Everyday supplies the Pi side; no new VS Code plugin is required. This integration is enabled automatically when a matching local editor is available. OMP remains unchanged.

**Migration:** before using this feature, set VS Code's `piContext.autoInstallCompanion` to `false`, then back up and move the old `pi-vscode-context.ts` outside Pi's extension directories. Check both personal and project extensions. Keep exactly one Pi-side implementation enabled to avoid duplicate tools, messages and statuses. The package never edits your VS Code settings or removes personal extensions. To roll back, use a pre-integration package revision before restoring the old companion.

- Start Pi inside VS Code's integrated terminal, directly or through Herdr. Select text, then ask Pi about it. The active filename and selection are attached to your message; moving the selection alone sends no message.
- View the **same Herdr session and pane** from WezTerm to continue using the same Pi. This does not transfer a Pi launched outside Herdr into Herdr.
- Same-project Pi sessions can independently read the same selection; closing a sibling leaves the writer running. There is no exclusive writer designation or session routing.
- A compact native status below the input shows the filename and selected lines, or `no selection`. Unmatched sessions stay quiet; disconnected writing sessions invalidate their current context.
- `/vscode-auto off` stops automatic attachment for this Pi conversation; `/vscode-auto on` resumes it. A new conversation starts with auto-attachment enabled. Explicit reads remain available while auto-attachment is off.
- `/vscode` supplies the full current editor context on demand. The `vscode_context` and `open_in_editor` tools retain their existing names. Normal file editing remains unchanged.

Direct connections use `PI_VSCODE_PORT`. Every context must report a live workspace containing Pi's working directory. Inside Herdr, a missing port can be recovered from stable VS Code's unique single-folder workspace state: macOS uses `~/Library/Application Support/Code/User/workspaceStorage`; Windows uses `%APPDATA%/Code/User/workspaceStorage`. Saved ports are only discovery hints; a mismatched or ambiguous workspace remains unavailable. Other distributions, multi-root projects, remote/WSL setups and Linux discovery are outside this fallback. Explicit local ports still require a matching workspace.

SQLite reads use Node's bundled `node:sqlite` in a bounded local child process; no separate SQLite installation is needed. Shared terminal environments do not grant an unrelated project access to the editor context. The ordinary no-editor workflow continues without an editor status. Discovery and reconnect continue while the Pi session is alive.

**Bridge limitations:** the existing Bridge uses unauthenticated loopback sockets. Its VS Code sharing-pause control has known snapshot/invalidation gaps, and its send-selection shortcut can broadcast to connected clients. Pi Everyday preserves that external protocol and makes no stronger privacy guarantee. Use selected text only when comfortable sharing it with the active model. The tested baseline is Bridge 0.0.3; real terminal reattachment and display behavior still require per-machine checks.

### Image context pruning

Images introduced during the current turn remain available to the model. On later turns, their image data is replaced only in the outbound model context with a short instruction to re-read the original path or request the image again.

Session history, text, tool calls, and saved JSONL remain unchanged. An old image without a reusable path must be attached again for further visual analysis.

### Path Links

In Pi, Path Rendering turns supported existing local paths into terminal links:

- A file links to its containing directory.
- A directory links to itself.
- Inline-code paths, standalone path lines, and existing non-image Markdown links are supported.
- Relative, `~/`, and absolute paths work in normal assistant output.
- Custom Markdown views receive absolute Path Links only because their working directory is unknown.

For example, Pi can render generic paths such as `./output/result.txt`, `~/project`, or `/path/to/project` as actions when they exist. Missing paths, URLs, Markdown images, and every fenced block remain unchanged.

Path Rendering affects display only. It does not alter session history or model context.

OMP uses its native existing local Markdown links. This package does not add a plain-text path transformer to OMP.

Directory Opening is a separate terminal action: the shared WezTerm module opens a file's containing directory or a directory itself on Windows and macOS. It applies to **all `file:` links** in that WezTerm configuration, including links emitted by OMP, Pi, and other programs. Web links keep their existing behavior. Original messages, session history, and model context stay unchanged.

Enable Directory Opening with the [WezTerm setup](#wezterm-directory-opening-on-windows-and-macos) below. Paths must be directly accessible on the current computer, including locally synced OneDrive resources. The module performs no SSH remote resolution, WSL conversion, or Windows/macOS path mapping. An inaccessible path reports its actual error and cancels the default file action; it never falls back to opening the file.

### Codex image generation

Run the skill in Pi:

```text
/skill:codex-image-gen
```

Provide a prompt, optional ordered reference images within Codex's native limit, and an output such as `./output/image.png`. The skill uses your local Codex subscription and built-in `image_gen`, preserving the creative prompt and original artifacts.

An Image Request permits at most three generation submissions: recover first, retry temporary failures when needed. Waiting and saving do not submit another generation. Every valid result is shown, including late recoveries; the user chooses artistic quality. There are no fallback providers or Images API calls.

Image outcomes and execution checks are separate. Unknown logs or opaque exec wrappers are reported as incomplete checks, not proof that an image failed or that tool isolation was enforced. A nonzero exit can still include delivered images; the JSON `images` array is authoritative, while `path` is only its first entry. Original files are kept and existing destinations are never overwritten. The runner decodes images using Photon (also used by Pi), rather than trusting a filename extension.

Maintain compatibility with current Codex best practices and update the CLI through its existing installation method when necessary; no forced upgrade on every request. Diagnostics record the actual CLI version, attempts, artifact sources and check status without copying image base64.

## Privacy and security

- The package includes no telemetry.
- Usage status uses the active OpenAI OAuth token only for an in-memory request to the internal usage endpoint. It does not persist the token or account identifier.
- Path Rendering checks whether candidate paths exist and whether they are files or directories. It does not read file contents or send paths to a remote service.
- Image context pruning changes only the transient outbound model request. Saved session history is not rewritten.
- Editor Context can include unsaved selected text. Automatic or explicit attachment sends that content and file paths to the current model and may retain it in the conversation history. Disconnect clears the current cache; it does not erase past messages. See the Bridge limitations and migration steps above.
- An Image Run sends its prompt and optional reference images to OpenAI through the locally installed Codex CLI and consumes the subscription's image allowance.
- Codex owns its login and keeps its normal session records under `CODEX_HOME`. The package does not read or store Codex credentials.
- Image failure diagnostics and Codex records can contain prompts and local paths. Review them before sharing.

Default generated images and diagnostics use `.scratch/`, which should remain excluded from version control.

## Compatibility and limitations

- Pi 0.84.1 or newer.
- Node.js 22.19.0 or newer.
- macOS, Windows, and Linux.
- Path Links require a terminal that supports OSC 8 hyperlinks and `file://` URI handling.
- Windows/macOS Directory Opening uses the bundled WezTerm module with WezTerm 20240203 or newer and Node.js 22.19.0 or newer.
- Some terminals capture mouse input and require their hyperlink modifier while clicking. The WezTerm module binds Windows Ctrl+click and macOS Cmd+click in both mouse-reporting states.
- Usage status depends on an undocumented OpenAI endpoint and can stop working without notice.
- Image generation requires a compatible, authenticated local Codex CLI.
- Generated images and diagnostics remain after package removal until deleted manually.

Automated checks run on macOS, Windows, and Linux. Pointer behavior can still vary by terminal.

## Troubleshooting

### Path Links render but do not open

Confirm that the terminal enables OSC 8 hyperlinks and routes `file://` URIs to the operating system. Try the terminal's normal hyperlink modifier while clicking.

#### WezTerm Directory Opening on Windows and macOS

Use the same shipped `src/path-links/wezterm.lua` module on both platforms. It passes the complete `file:` URI as one argument to `src/path-links/resolve-folder.mjs`. Node uses standard URI decoding and an actual filesystem query to distinguish files from directories, then WezTerm opens the resulting native directory path.

Find the **installed package directory on this computer**. Global installations normally use these locations, relative to your home directory:

| Package source | `package_dir` |
| --- | --- |
| OMP plugin installation | `wezterm.home_dir .. '/.omp/plugins/node_modules/pi-everyday'` |
| Pi Git installation (`git:github.com/CWen001/pi-everyday`) | `wezterm.home_dir .. '/.pi/agent/git/github.com/CWen001/pi-everyday'` |
| Pi npm installation (`npm:pi-everyday`) | `wezterm.home_dir .. '/.pi/agent/npm/node_modules/pi-everyday'` |

Use the location of your active installation, not an old copy left by another package source. For a project-local installation or a custom checkout, set `package_dir` to that actual absolute directory. Confirm it contains both `src/path-links/wezterm.lua` and `src/path-links/resolve-folder.mjs`; the resolver option points to the latter, not the package directory.

Merge this into `%USERPROFILE%\.wezterm.lua` on Windows or `~/.wezterm.lua` on macOS, using the `config` table your existing file returns:

```lua
local wezterm = require 'wezterm'
-- Keep your existing config initialization and unrelated settings.
local config = wezterm.config_builder()

-- OMP installation; use the active Pi Git/npm path above when appropriate.
local package_dir = wezterm.home_dir .. '/.omp/plugins/node_modules/pi-everyday'
local apply_directory_opening = dofile(package_dir .. '/src/path-links/wezterm.lua')
apply_directory_opening(config, {
  node_program = 'node',
  resolver = package_dir .. '/src/path-links/resolve-folder.mjs',
})

-- Keep your remaining unrelated settings.
return config
```

Call `apply_directory_opening` once, after your existing `config.mouse_bindings` assignments and before `return config`. Reuse your existing `config`; do not replace it with a second table or overwrite unrelated settings. The module replaces only single-left-button Down/Up bindings for the platform's link modifier, including macOS `CMD`/`WIN` aliases for `SUPER`. It installs Down=`Nop` and Up=`OpenLinkAtMouseCursor` for both `mouse_reporting=false` and `mouse_reporting=true`; other chords, buttons, streaks, and drag bindings remain intact. This lets WezTerm handle the click even when Herdr or another terminal application captures mouse input.

Replace the previous `file:` branch or file-only `open-uri` handler with this module. Preserve custom handling for other URI schemes, and register the module before any remaining handler that could return `false` for a `file:` URI. An earlier `return false` stops later handlers: appending this module behind the old file handler leaves that old behavior active. The module lets non-file URI schemes fall through unchanged.

**Use Node.js 22.19.0 or newer.** A GUI-launched WezTerm may have a different `PATH` from your interactive shell. `node_program` defaults to `'node'`; set it to the actual absolute Node executable when that name is unavailable to WezTerm:

- **Windows:** run `(Get-Command node).Source` in PowerShell and use the returned executable path, with forward slashes or a Lua long string. A standard installation might use `node_program = 'C:/Program Files/nodejs/node.exe'`. Use your installed path if it differs.
- **macOS:** run `command -v node` and `node --version` in your shell. Set `node_program` to the returned absolute executable path. Homebrew commonly provides `/opt/homebrew/bin/node` on Apple Silicon and `/usr/local/bin/node` on Intel; use `command -v node` to locate your actual binary, including version-manager installations.

Reload your WezTerm configuration, then Ctrl+click on Windows or Cmd+click on macOS an existing file link, directory link, and web link. The file opens its parent directory, the directory opens itself, and the web link follows your existing handler/browser behavior. If resolving or opening fails, inspect WezTerm's error log for the actual error and correct the inaccessible resource, helper path, or Node executable.

Package updates ship the module and resolver; they do not edit user-owned WezTerm configuration. Integrate this setup separately on each computer and reload the configuration after updates. Keep standard `file:` links rather than adding a Herdr link-handler plugin, a sentinel HTTPS domain, or edits to installed host/terminal files.

For an unreleased local change, transfer `src/path-links/wezterm.lua` and `src/path-links/resolve-folder.mjs` from the modified checkout to the other computer. A registry reinstall uses the published package, so preserve these local runtime files until a release includes the change. They also work from a separate user-owned directory: load `wezterm.lua` there and set `options.resolver` to the adjacent `resolve-folder.mjs`; the resolver uses Node core modules only.

### Usage status is absent

Confirm that Pi or OMP has an active `openai-codex` OAuth login. Endpoint failures intentionally remain silent.

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

On another computer, install the published version with `pi install npm:pi-everyday`, then use the update command above. For an existing Git installation, preserve local edits and run `pi update git:github.com/CWen001/pi-everyday`; this also provides unreleased changes such as Editor Context. Run `/reload` after updating. Keep one package source enabled. Switch from Git to npm only after the desired functionality is included in a published release.

Directory Opening also requires the user-owned WezTerm configuration integration described above. Package updates alone do not install or replace that configuration; reload WezTerm after updating its module.

Update all installed Pi packages:

```bash
pi update --extensions
```

Remove it:

```bash
pi remove npm:pi-everyday
```

Removing the package stops its extensions and removes its bundled skill. It does not delete generated images or diagnostics, or revert user-owned OMP layout settings. Remove the Directory Opening module call from your WezTerm configuration before removing the package.

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

### Unreleased

- Integrate Editor Context into Pi with native low-interference status, existing commands/tools and independent per-session attachment.
- Add macOS/Windows Herdr workspace discovery using Node's bundled SQLite, live workspace validation, bounded input validation and cleanup.
- Document replacing the separate companion while retaining the existing VS Code Bridge.

### 0.3.2

- Add one shared Windows/macOS WezTerm Directory Opening module and Node filesystem resolver: files open their containing directory, directories open themselves, and web links keep their existing handling.
- Add Windows Ctrl+click and macOS Cmd+click bindings in both mouse-reporting states while preserving unrelated terminal settings.
- Remove the OMP path-rendering adapter for the unavailable `registerAssistantTextTransformer` API; OMP uses its native existing local Markdown links, while Pi keeps Path Rendering.
- Document per-computer package/helper paths, Node requirements, and user-owned WezTerm configuration integration.

### 0.3.1

- Enable Codex usage status in the OMP adapter using the shared provider-level authentication API.
- Document the optional compact OMP layout and Windows Path Link opening through WezTerm.
- Remove the bundled `/review` prompt; code review remains the host's responsibility.

## License

MIT. The Editor Context Module derives from zenyui/vscode-pi; its original MIT copyright and license notice are retained in `src/editor-context.ts`.
