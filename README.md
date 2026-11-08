# pi-everyday

Small, additive conveniences for [Pi](https://pi.dev) and OMP:

- Show remaining subscription quota through your locally authenticated Codex CLI.
- Keep old images out of future model requests without changing session history.
- Reassess an empty or tool-free reply once after a pstack completion notification in Pi.
- Receive VS Code file/selection context in Pi, including shared Herdr sessions on macOS and Windows.
- Render local Path Links in Pi. In Windows/macOS WezTerm, Ctrl-click opens the target and held Alt/Option-click opens its folder.
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

Shows remaining quota and reset time, for example `7d 71% left (5d 14h)`, using the official Codex app-server `account/rateLimits/read` method. Install and log into Codex CLI on the same machine. Only returned usage windows are displayed; there are no extra labels or notifications.

This is the local Codex account's quota, independent of Pi's selected model or login. The extension does not read Pi credentials or claim support for querying the new `openai` login directly; see the [authentication distinction](docs/research/openai-usage-contract.md).

Refresh is non-blocking, with a ten-second deadline and five-minute cooldown. Missing CLI, failed or unavailable queries silently hide the status. Each query's process is stopped when done or cancelled. The native footer and other statuses are preserved.

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

Install [VS Code Pi Agent Bridge](https://github.com/zenyui/vscode-pi) (`zenyui.vscode-pi-bridge`), then install or update Pi Everyday using [Update and remove](#update-and-remove). Pi Everyday supplies the Pi side; no additional VS Code plugin is required. Keep one package source enabled. OMP remains unchanged.

Package installation prepares the stable VS Code integration automatically before Pi loads extensions. Setup changes only the Bridge installation preference and removes fingerprint-verified redundant integration files; unrelated settings and customized extensions are preserved. Installing without VS Code leaves its configuration untouched.

For a local checkout, project-specific setup, or installation with lifecycle scripts disabled, run this **from the project directory** before starting Pi, using your active package directory:

```bash
npm --prefix <active-package-directory> run setup
```

For example, a personal npm installation normally uses `$HOME/.pi/agent/npm/node_modules/pi-everyday`. A local checkout uses its actual directory. Setup is safe to repeat. After updating an already-running Pi, run `/reload`.

- Start Pi inside VS Code's integrated terminal, directly or through Herdr. Select text, then ask Pi about it. The active filename and selection are attached to your message; moving the selection alone sends no message.
- View the **same Herdr session and pane** from WezTerm to continue using the same Pi. This does not transfer a Pi launched outside Herdr into Herdr.
- Same-project Pi sessions can independently read the same selection; closing a sibling leaves the writer running. There is no exclusive writer designation or session routing.
- A compact native status below the input shows the filename and selected lines, or `no selection`. Unmatched sessions stay quiet; disconnected writing sessions invalidate their current context.
- `/vscode-auto off` stops automatic attachment for this Pi conversation; `/vscode-auto on` resumes it. A new conversation starts with auto-attachment enabled. Explicit reads remain available while auto-attachment is off.
- `/vscode` supplies the full current editor context on demand. `/vscode doctor` explains the current connection locally, without sending diagnostics or editor text to the model. The `vscode_context` and `open_in_editor` tools retain their existing names. Normal file editing remains unchanged.

Direct connections use `PI_VSCODE_PORT`. Every context must report a live workspace containing Pi's working directory. Inside Herdr, a missing port can be recovered from stable VS Code's unique single-folder workspace state: macOS uses `~/Library/Application Support/Code/User/workspaceStorage`; Windows uses `%APPDATA%/Code/User/workspaceStorage`. Saved ports are only discovery hints; a mismatched or ambiguous workspace remains unavailable. Other distributions, multi-root projects, remote/WSL setups and Linux discovery are outside this fallback. Explicit local ports still require a matching workspace.

SQLite reads use Node's bundled `node:sqlite` in a bounded local child process; no separate SQLite installation is needed. Shared terminal environments do not grant an unrelated project access to the editor context. The ordinary no-editor workflow continues without an editor status. Discovery and reconnect continue while the Pi session is alive.

**Bridge limitations:** the existing Bridge uses unauthenticated loopback sockets. Its VS Code sharing-pause control has known snapshot/invalidation gaps, and its send-selection shortcut can broadcast to connected clients. Pi Everyday preserves that external protocol and makes no stronger privacy guarantee. Use selected text only when comfortable sharing it with the active model. The tested baseline is Bridge 0.0.3; real terminal reattachment and display behavior still require per-machine checks.

### Completion-reply recovery (Pi 1.5+)

After a pstack completion notification, a normal empty or tool-free reply receives one reassessment of the original task. Wording does not matter. The visible reminder preserves existing task budgets and tells the model to restate any pending human question or approval gate and stop. It does not grant authorization. Another eligible stop produces one neutral exhaustion notice without another retry. Exhaustion does not determine whether the task is complete.

Tool activity is checked separately for the initial response and the response after the committed retry reminder. A nonempty reply after a successful or failed tool call or result is left alone. An empty reply remains eligible after tools. Earlier tools cannot mask a tool-free reassessment, and tools do not prove task completion.

Detection requires a visible completion and an uninterrupted response span in the active projected context. User input, unrelated custom messages, invalid completions, omitted ordinary replies and missing completion evidence stop detection. Compaction or branch summaries can remove the required evidence. Omitted or edited tool calls and results still veto claims of inactivity within their response segment. Passive `vscode-context` messages are transparent.

Both response segments share one retry per exact notification, using the existing `pi-everyday-empty-turn` receipts. Legacy receipts consume that same allowance. Reloads, compaction, and navigation to sibling branches do not reset recorded budgets. Forks or exports that omit receipts cannot preserve the budget. Known running pstack workers, future `schedule_wakeup` timers, malformed wait records, pending messages, and prior continuation proposals suppress recovery. Foreign settle drafts also defer recovery, except passive editor context. Cancellation prevents continuation, although Pi can still commit a reminder and consume its receipt if cancellation occurs during settlement. Cancelling a timer does not re-arm it.

**Limits:** every eligible tool-free summary or human approval request can cost one extra model turn, even when it is a valid stopping point. The reminder preserves gates as instructions, not an enforcement layer. Nonempty stalls after tools, undelivered notices and other background schedulers are outside this change. The guard reads pstack records without modifying pstack, scheduling tasks, or inspecting TODO files. It does not diagnose provider failures or guarantee autonomous completion.

Tests use the real Pi SDK with a local synthetic HTTP provider. They reproduce the fresh-status and repeated-status incidents and verify a resumed built-in `read` and its actual fixture contents. They cover paraphrase exhaustion, separate response segments, boundaries, wait protections, projected edits, legacy receipts, reload, disk restore, compaction, and sibling branches. They do not prove real-model adherence or replace separate permission controls. The feature requires Pi 1.5 or newer and is not registered by the OMP entrypoint. Windows and macOS use the same implementation; this change was tested on Windows.

### Image context pruning

Images introduced during the current turn remain available to the model. On later turns, their image data is replaced only in the outbound model context with a short instruction to re-read the original path or request the image again.

Session history, text, tool calls, and saved JSONL remain unchanged. An old image without a reusable path must be attached again for further visual analysis.

### Path Links

In Pi, Path Rendering turns supported existing local paths into terminal links:

- A file keeps its original label and file URI, followed by a separate `folder` link to its containing directory.
- A directory links only to itself. Explicit `file:` Markdown links keep their original URI, including navigation suffixes, and receive the same folder companion for existing files.
- Inline-code paths, standalone path lines, and existing non-image Markdown links are supported.
- Relative, `~/`, and absolute paths work in normal assistant output.
- Custom Markdown views receive absolute Path Links only because their working directory is unknown.

For example, Pi can render generic paths such as `./output/result.txt`, `~/project`, or `/path/to/project` as actions when they exist. Missing paths, URLs, Markdown images, and every fenced block remain unchanged.

Bare Markdown targets support balanced parentheses without nesting, including `report (1).txt` in encoded file URIs. Explicit angle-bracket targets such as `[report](<file:///path/report%20(1).txt>)` also support nested or unmatched parentheses. Standalone path lines still require paths without whitespace.

Path Rendering affects display only. It does not alter session history or model context.

OMP uses its native existing local Markdown links. This package does not add a plain-text path transformer to OMP.

Activate the original file link to open the file, or its `folder` companion to open the containing directory. Both are standard `file:` URIs and use the same activation modifier. Repeated ordinary and custom Markdown rendering does not duplicate companions. Inside captured Herdr sessions, the [bundled native plugin](#herdr-mouse-capture) uses Ctrl-click on Windows and macOS without sampling other modifiers.

For links handled directly by WezTerm, the existing module also supports held Alt/Option-click on the original file link for Directory Opening. Ctrl-click performs Target Opening on both platforms, and Cmd-click also works on macOS. A directory opens itself in either mode. These rules apply to all `file:` links handled by that module. Web links retain their existing handlers.

Enable direct-terminal actions with the [WezTerm setup](#wezterm-file-and-folder-opening-on-windows-and-macos) below. Plain clicks remain available to Herdr, selection, pane focus, and terminal applications. The module does not bind unmodified clicks to opening links. Ctrl, Alt, and macOS Cmd single-left clicks are reserved for link activation in both mouse-reporting states, so those modified clicks are no longer application input.

For the direct WezTerm route, keep Alt/Option held until activation completes. Its handler reads current keyboard modifiers before resolving the URI, not an immutable snapshot of the click. Releasing or changing modifiers before that read can select a different action. There is no pending intent flag carried into later clicks.

Paths must be directly accessible on the current computer, including locally synced OneDrive resources. The module performs no SSH remote resolution, WSL conversion, or Windows/macOS path mapping. Modifier-query, resolver, and synchronous Lua errors are logged and cancel the default file action. They never fall back to another target. WezTerm's `open_with` does not report OS launch results. A missing file association or later OS failure may require checking the operating system rather than the WezTerm log.

### Codex image generation

Run the skill in Pi:

```text
/skill:codex-image-gen
```

Provide a prompt, optional ordered reference images within Codex's native limit, and an output such as `./output/image.png`. The skill uses your local Codex subscription and built-in `image_gen`, preserving the creative prompt and original artifacts.

An Image Request defaults to an allowance of three observable image-tool submissions: recover first, retry temporary failures when needed. Pass `--max-submissions 1` to the skill's runner for a single-call allowance with no outer regeneration (`1`, `2`, or `3`; default `3`). Waiting and saving do not submit another generation. Call-ID evidence and prompt instructions bound the wrapper's continuation; Codex owns native HTTP retries, so this is not a guarantee of backend request counts or charges. Every valid result is shown, including late recoveries; the user chooses artistic quality. There are no fallback providers or direct Images API calls from the wrapper.

Image outcomes and execution checks are separate. Independent damaged records retain other trustworthy images, while conflicting artifact identities are excluded. Unknown generation evidence stops further submissions when the count is uncertain; unrelated new fields can accompany valid delivery. Unknown logs or opaque exec wrappers are reported as incomplete checks, not proof that an image failed or that tool isolation was enforced. A nonzero exit can still include delivered images; the JSON `images` array is authoritative, while `path` is only its first entry. Original files are kept and existing destinations are never overwritten. The runner decodes images using Photon (also used by Pi), rather than trusting a filename extension.

Maintain compatibility with current Codex best practices and update the CLI through its existing installation method when necessary; no forced upgrade on every request. Diagnostics record the actual CLI version, attempts, artifact sources and check status without copying image base64.

## Privacy and security

- The package includes no telemetry.
- Usage queries run the local `codex app-server`; Codex manages its own authentication and contacts OpenAI. The package reads only the quota response, not credential files, and starts no inference task.
- Path Rendering checks whether candidate paths exist and whether they are files or directories. It does not read file contents or send paths to a remote service.
- Image context pruning changes only the transient outbound model request. Saved session history is not rewritten.
- Editor Context can include unsaved selected text. Automatic or explicit attachment sends that content and file paths to the current model and may retain it in the conversation history. Disconnect clears the current cache; it does not erase past messages. See the Bridge limitations above. Editor setup changes one installation preference and removes only verified redundant files; package removal does not restore that preference.
- An Image Run sends its prompt and optional reference images to OpenAI through the locally installed Codex CLI and consumes the subscription's image allowance.
- Codex owns its login and keeps its normal session records under `CODEX_HOME`. The package does not read or store Codex credentials.
- Image failure diagnostics and Codex records can contain prompts and local paths. Review them before sharing.

Default generated images and diagnostics use `.scratch/`, which should remain excluded from version control.

## Compatibility and limitations

- Maintained against current stable Pi; development baseline 1.0.2. Older Pi compatibility is not maintained.
- Node.js 22.19.0 or newer.
- macOS, Windows, and Linux.
- Path Links require a terminal that supports OSC 8 hyperlinks and `file://` URI handling.
- Captured Herdr sessions use the optional bundled plugin on Windows and macOS. It requires Herdr 0.9.4 or newer with native link handlers and Node.js 22.19.0 or newer on Herdr's PATH. Linking is manual; package installation does not register the plugin.
- Direct WezTerm Target Opening and Directory Opening use the bundled WezTerm module, WezTerm 20240203 or newer with `window:keyboard_modifiers()`, and Node.js 22.19.0 or newer.
- The WezTerm module binds Ctrl+click and Alt/Option+click on both platforms, plus Cmd+click on macOS, in both mouse-reporting states. Alt/Option must remain held during activation. Plain clicks are unchanged.
- Quota display requires an authenticated `codex` executable on Pi's PATH. Verified with Codex CLI 0.160.0 on macOS; other platforms are best effort (Windows `.cmd`-only launchers are not supported by this reader).
- Image generation requires a compatible, authenticated local Codex CLI.
- Generated images and diagnostics remain after package removal until deleted manually.

Automated checks run on macOS, Windows, and Linux. Pointer behavior can still vary by terminal.

## Troubleshooting

### VS Code selection is unavailable

Run `/vscode doctor`. It reports Pi's working directory, the discovery method, and a specific connection result without attaching the report to the model.

- `no-matching-workspace` or `workspace-mismatch`: open Pi's project in VS Code, or start Pi from the corresponding workspace directory. For example, VS Code opened on project A cannot supply selections to Pi running in unrelated directory B. `/reload` does not change Pi's working directory.
- `ambiguous-workspace`: saved state contains multiple matching candidates. Keep one matching workspace available; Pi does not guess which editor to use.
- `invalid-port` or `connection-refused`: reopen a VS Code integrated terminal for a current port. Inside Herdr, an absent `PI_VSCODE_PORT` enables workspace discovery; a stale explicit port takes precedence over discovery.
- `workspace-storage-unavailable` or `no-readable-saved-port`: confirm stable VS Code and Bridge are running on this computer. Herdr fallback supports single-folder workspaces on macOS/Windows, not other distributions, multi-root workspaces or remote/WSL setups.

If integration fails during Pi startup, run the setup command above from the project directory before starting Pi again. Check its report for settings or permission errors. Setup leaves unrecognized files in place rather than deleting custom extensions.

Once connected, select text and send your question. Selecting text alone sends no model message. `/vscode-auto on` enables automatic attachment; `/vscode` reads context explicitly. Unchanged attachments are deduplicated.

### Path Links render but do not open

Confirm that the terminal enables OSC 8 hyperlinks and routes `file://` URIs to the operating system. Try the terminal's normal hyperlink modifier while clicking. Inside Herdr, check [mouse capture](#herdr-mouse-capture) before changing WezTerm bindings. Reloading Pi does not change Herdr's link handling.

#### WezTerm file and folder opening on Windows and macOS

Use the same shipped `src/path-links/wezterm.lua` module on both platforms. It reads held modifiers first, then passes the original `file:` URI and an explicit `target` or `folder` argument to `src/path-links/resolve-folder.mjs`, without a shell. Node decodes the URI once and checks the filesystem. The resolver returns JSON containing `path`, the native file or directory to open. Unknown intents and inaccessible paths fail rather than guessing.

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

local package_dir = wezterm.home_dir .. '/.pi/agent/npm/node_modules/pi-everyday'
local apply_path_opening = dofile(package_dir .. '/src/path-links/wezterm.lua')
apply_path_opening(config, {
  node_program = 'node',
  resolver = package_dir .. '/src/path-links/resolve-folder.mjs',
})

-- Keep your remaining unrelated settings.
return config
```

Call `apply_path_opening` once, after your existing `config.mouse_bindings` assignments and before `return config`. Reuse your existing `config`; do not replace it with a second table or overwrite unrelated settings. The module replaces single-left-button Down/Up bindings for `CTRL` and `ALT`, plus `SUPER` and its `CMD`/`WIN` aliases on macOS. It installs Down=`Nop` and Up=`OpenLinkAtMouseCursor` for both `mouse_reporting=false` and `mouse_reporting=true`. Unmodified bindings and other chords, buttons, streaks, and drag bindings remain intact. These bindings let WezTerm handle modified clicks during mouse reporting, but opening a link still requires WezTerm to receive its target. Herdr mouse capture can prevent that.

Replace the previous `file:` branch or file-only custom `open-uri` handler with this module. Do not layer it behind the old directory-only policy or a handler that calls `open_with(url.file_path)`. An earlier `return false` stops later handlers, and a handler that opens without stopping can open twice. Preserve custom handlers for other schemes, but make them ignore `file:` URIs. The module lets non-file schemes fall through unchanged. Update the module and resolver together because the resolver now requires an intent and returns `path` instead of `folder`.

**Use Node.js 22.19.0 or newer.** A GUI-launched WezTerm may have a different `PATH` from your interactive shell. `node_program` defaults to `'node'`; set it to the actual absolute Node executable when that name is unavailable to WezTerm:

- **Windows:** run `(Get-Command node).Source` in PowerShell and use the returned executable path, with forward slashes or a Lua long string. A standard installation might use `node_program = 'C:/Program Files/nodejs/node.exe'`. Use your installed path if it differs.
- **macOS:** run `command -v node` and `node --version` in your shell. Set `node_program` to the returned absolute executable path. Homebrew commonly provides `/opt/homebrew/bin/node` on Apple Silicon and `/usr/local/bin/node` on Intel; use `command -v node` to locate your actual binary, including version-manager installations.

Reload your WezTerm configuration, then Ctrl+click an existing file link on either platform. It opens the file through the operating system's file association. Hold Alt/Option while clicking the same link and keep it held until activation completes. It opens the parent directory. A directory link opens itself in either mode, and a web link follows your existing handler/browser behavior. Verify plain selection, pane focus, and application controls in your Herdr session. If an action fails, inspect WezTerm's error log and correct the modifier API, inaccessible resource, helper path, or Node executable.

Package updates ship the module and resolver; they do not edit user-owned WezTerm configuration. Integrate this setup separately on each computer and reload the configuration after updates. Keep standard `file:` links. For Herdr, choose one of the routes below rather than rewriting links to a sentinel HTTPS domain or editing installed host files.

For an unreleased local change, use the updated package checkout on each computer so Path Rendering emits original file URIs. Copying only the terminal helpers cannot recover a file from an old directory-only link. Keep `src/path-links/wezterm.lua` and `src/path-links/resolve-folder.mjs` from the same revision. They can also run from a separate user-owned directory. Load `wezterm.lua` there and point `options.resolver` at the adjacent `resolve-folder.mjs`. The resolver uses Node core modules only. A registry reinstall uses the published package, not unreleased source changes.

#### Herdr mouse capture

On Windows, Herdr `0.9.4-preview` at revision `fbd2ae23927f` does not forward explicit OSC 8 links to WezTerm when `ui.mouse_capture = true`. Herdr handles clicks itself. Its built-in opener accepts HTTP and HTTPS links. Local `file:` links require a native link handler. See Herdr's versioned [quick start](https://raw.githubusercontent.com/herdrdev/herdr/fbd2ae23927f/docs/next/website/src/content/docs/quick-start.mdx) and [plugin documentation](https://raw.githubusercontent.com/herdrdev/herdr/fbd2ae23927f/docs/next/website/src/content/docs/plugins.mdx).

Choose the route that matches the mouse behavior you need:

- To let WezTerm open links, set `mouse_capture = false` under `[ui]` in your Herdr user configuration. Run `herdr config check`, then `herdr server reload-config`. This also disables Herdr tab clicks and split-border dragging.
- To retain Herdr mouse controls, keep capture enabled and link the bundled native `file:` handler below. Let Ctrl-left-click reach Herdr. If using the WezTerm module above, remove its Ctrl single-left-button Down and Up bindings with `mouse_reporting = true` after calling `apply_path_opening`. Preserve bindings for `mouse_reporting = false` and all unrelated mouse controls.

The package ships `src/path-links/herdr/herdr-plugin.toml` and `open-target.mjs`. It does not register the plugin or change your configuration. Use the active package directory from the table above, then link its plugin directory:

```text
herdr plugin link "/absolute/path/to/pi-everyday/src/path-links/herdr"
herdr plugin log list --plugin pi-everyday.local-links
```

Before linking, disable or unlink any competing directory-only `file:` handler. Preserve its files and registration details if you need to restore it. Do not leave multiple handlers responsible for the same links.

Herdr runs the manifest's Node command from the plugin directory and supplies `HERDR_PLUGIN_CLICKED_URL`. The entry also accepts exactly one URI argument for direct invocation, without a `target` or `folder` option. It reuses `../resolve-folder.mjs` with target intent. Keep that resolver in the plugin's parent directory when moving or updating the source.

Ctrl-click the original file link to open that file through its native association. Ctrl-click `folder` to open the containing directory. The plugin never reads keyboard modifiers or chooses a parent directory. It accepts local `file:` URIs, including `localhost`, and rejects remote authorities, credentials, malformed escapes, controls, encoded path separators, and Windows-incompatible paths. The shared resolver retains its broader UNC and target/folder contract for other consumers.

Windows launches `%SystemRoot%\explorer.exe` with one native path argument and `windowsHide: false`. macOS launches `/usr/bin/open`. Both launches are shell-free. The command reports `{ "path": "...", "accepted": true }` after process creation, not after a window becomes visible. Launch errors exit nonzero; a later association or OS failure can occur after acceptance.

Verify actual clicks on both entries after choosing a route. A resolver test, mocked launch, or direct handler invocation does not establish the mouse-click route or visible OS opening. Inspect the plugin log for native activation. The capture behavior above was observed on Windows at the cited Herdr revision. Real file associations and visible opening with this bundled plugin still require Windows and macOS verification.

### Usage status is absent

Confirm `codex --version` works from Pi's environment and the CLI is logged in (`codex login`). Run `/reload` after installing or logging in. Quota comes from that Codex account, not Pi's login. Query failures stay silent; usage can also be reviewed in [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage).

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

On another computer, install the published version with `pi install npm:pi-everyday`, then use the update command above. For an existing Git installation, preserve local edits and run `pi update git:github.com/CWen001/pi-everyday`. Run `/reload` after updating. Keep one package source enabled. Switch from Git to npm only after the desired functionality is included in a published release.

Target Opening and Directory Opening also require the user-owned WezTerm configuration integration described above. Package updates alone do not install or replace that configuration; reload WezTerm after updating its module.

Update all installed Pi packages:

```bash
pi update --extensions
```

Remove it:

```bash
pi remove npm:pi-everyday
```

Removing the package stops its extensions and removes its bundled skill. It does not delete generated images or diagnostics, or revert user-owned OMP layout settings. Remove the path-opening module call from your WezTerm configuration before removing the package.

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

### 0.4.4

- Recover identical repeated pstack completion replies once when no intervening tools or known waits explain the stop.
- Share the existing empty-reply budget and show a warning when recovery is exhausted.
- Preserve existing approval instructions. Identical valid summaries or human questions can also receive one reassessment; this is not a permission enforcement layer.
- Verify the original three-worker incident through the real Pi SDK and an actual built-in file read. Ubuntu, macOS, and Windows CI passed.

### 0.4.3

- Add one bounded empty-reply recovery after pstack completion notifications on Pi 1.5+, with visible reminders and cancellation support.
- Preserve running-worker waits, scheduled wakeups and existing task budgets. Keep recovery receipts in the session.
- Verify the failure and recovery through real Pi sessions with a local synthetic provider.

### 0.4.1

- Preserve original file URIs in Path Rendering so file links no longer lose their filenames.
- Use Ctrl-click to open files and held Alt/Option-click to open their folders in the shared Windows/macOS WezTerm module. Keep ordinary Herdr mouse input unchanged.
- Require the terminal module and resolver to update together. Replace an older file-only URI handler rather than adding a second handler.
- Restore remaining quota and reset-time display through the local Codex app-server, without labels or failure notifications.
- Prepare stable VS Code integration during installation with bounded, fingerprint-verified cleanup and JSONC-preserving settings updates.
- Add local `/vscode doctor` connection diagnostics without changing workspace isolation or sending diagnostics to the model.

### 0.4.0

- Target Pi 1.0.2 for development; make usage refresh non-blocking, bounded and session-safe, clearing stale values on failure.
- Remove legacy quota lookup; keep current ChatGPT quota display hidden until its query contract is verified.
- Retain independent trusted image results through damaged evidence, quarantine conflicting identities and stop retries on uncertain generation counts.
- Add a lower `--max-submissions` allowance for bounded requests and single-call acceptance checks.
- Integrate Editor Context into Pi with native low-interference status, existing commands/tools and independent per-session attachment.
- Add macOS/Windows Herdr workspace discovery using Node's bundled SQLite, live workspace validation, bounded input validation and cleanup.
- Retain the existing VS Code Bridge as the editor-side integration.

### 0.3.2 (Git-only development; included in 0.4.0)

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
