/*
Derived from zenyui/vscode-pi (MIT), with local and pi-everyday adaptations.
MIT License

Copyright (c) 2026 zenyui

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "path";
import * as net from "net";
import * as crypto from "crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const STATUS_KEY = "vscode";
const PORT_ENV = "PI_VSCODE_PORT";

interface Selection {
  startLine: number;
  endLine: number;
  text: string;
  truncated: boolean;
}
interface OpenFile {
  path: string;
  active: boolean;
  languageId?: string;
  dirty: boolean;
}
interface Ctx {
  workspace?: string | null;
  activeFile: string | null;
  openFiles: OpenFile[];
  selection: { path: string; languageId: string; cursorLine: number; selections: Selection[] } | null;
}

function isContext(value: unknown): value is Ctx {
  if (!value || typeof value !== "object") return false;
  const c = value as Ctx;
  const line = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 1;
  return typeof c.workspace === "string" &&
    (c.activeFile === null || typeof c.activeFile === "string") &&
    Array.isArray(c.openFiles) && c.openFiles.every(f => f && typeof f.path === "string" &&
      typeof f.active === "boolean" && typeof f.dirty === "boolean") &&
    (c.selection === null || (!!c.selection && typeof c.selection.path === "string" &&
      typeof c.selection.languageId === "string" && line(c.selection.cursorLine) &&
      Array.isArray(c.selection.selections) && c.selection.selections.every(s => s &&
        line(s.startLine) && line(s.endLine) && s.endLine >= s.startLine &&
        typeof s.text === "string" && typeof s.truncated === "boolean")));
}

// Short one-liner for the TUI footer: "vscode: extension.ts L120-148"
function statusLine(data: Ctx): string {
  const sel = data.selection;
  if (sel && sel.selections.length > 0) {
    const file = path.basename(sel.path);
    const ranges = sel.selections
      .map((s) => (s.startLine === s.endLine ? `L${s.startLine}` : `L${s.startLine}-${s.endLine}`))
      .join(", ");
    return `vscode: ${file} ${ranges}`;
  }
  if (data.activeFile) {
    return `vscode: ${path.basename(data.activeFile)} (no selection)`;
  }
  return "vscode: no file";
}

// Full markdown view of the editor state (for the pull tool + /vscode command).
function renderMarkdown(data: Ctx): string {
  const lines: string[] = ["# VSCode editor context", ""];

  lines.push("## Active file");
  lines.push(data.activeFile ? `\`${data.activeFile}\`` : "_none_");
  lines.push("");

  lines.push("## Open files");
  if (!data.openFiles.length) {
    lines.push("_none_");
  } else {
    for (const f of data.openFiles) {
      const marks = [f.active ? "active" : null, f.dirty ? "unsaved" : null].filter(Boolean).join(", ");
      lines.push(`- \`${f.path}\`${marks ? ` (${marks})` : ""}`);
    }
  }
  lines.push("");

  lines.push("## Selection");
  const sel = data.selection;
  if (!sel || sel.selections.length === 0) {
    const cur = sel ? ` (cursor at line ${sel.cursorLine})` : "";
    lines.push(`_no selection_${cur}`);
  } else {
    for (const s of sel.selections) {
      lines.push(`\`${sel.path}\` lines ${s.startLine}-${s.endLine}${s.truncated ? " (truncated)" : ""}:`);
      lines.push("");
      lines.push("```" + sel.languageId);
      lines.push(s.text);
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n") + "\n";
}

// ---- Live socket link to the VSCode extension (server) ----------------------
// VSCode owns the server and exports its port via PI_VSCODE_PORT. We dial it,
// receive `context` pushes (drive footer + injection + tools), receive `inject`
// (drop a mention into the prompt), and send `open` requests.
interface LiveLink {
  diagnostic: { source: string; reason: string };
  ready: Promise<void>;
  latest: Ctx | null;
  send: (msg: { type: "open"; path: string; line?: number; endLine?: number; column?: number }) => boolean;
  connected: () => boolean;
  stop: () => void;
}

function validPort(value: unknown): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function insideWorkspace(workspace: string, cwd: string): boolean {
  const relative = path.relative(workspace, cwd);
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

function discoverVscode(cwd: string): { target: { port: number; workspace: string } | null; reason: string } {
  // Stable Code single-folder workspaces; other layouts use PI_VSCODE_PORT.
  const storage = process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code", "User", "workspaceStorage")
    : path.join(os.homedir(), "Library", "Application Support", "Code", "User", "workspaceStorage");
  try {
    const current = fs.realpathSync(cwd);
    const matches: { port: number; workspace: string }[] = [];
    let matchingWorkspace = false;
    for (const entry of fs.readdirSync(storage)) {
      try {
        const dir = path.join(storage, entry);
        const meta = JSON.parse(fs.readFileSync(path.join(dir, "workspace.json"), "utf8"));
        if (typeof meta.folder !== "string" || !meta.folder.startsWith("file:")) continue;
        const workspace = fs.realpathSync(fileURLToPath(meta.folder));
        if (!insideWorkspace(workspace, current)) continue;
        matchingWorkspace = true;
        // Node's bundled SQLite works on both platforms. Isolate its experimental
        // warning in this bounded child, keeping the interactive Pi process quiet.
        const state = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", `
          const { DatabaseSync } = require('node:sqlite');
          const db = new DatabaseSync(process.argv[1], { readOnly: true });
          try {
            const row = db.prepare("SELECT value FROM ItemTable WHERE key='zenyui.vscode-pi-bridge'").get();
            process.stdout.write(row?.value ?? '');
          } finally { db.close(); }
        `, path.join(dir, "state.vscdb")],
          { encoding: "utf8", timeout: 1000, maxBuffer: 16384, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
        const port = validPort(JSON.parse(state)["piContext.port"]);
        if (port) matches.push({ port, workspace });
      } catch { /* Closed, unavailable, or unrelated workspace. */ }
    }
    if (matches.length === 1) return { target: matches[0], reason: "connecting" };
    return { target: null, reason: matches.length > 1 ? "ambiguous-workspace" : matchingWorkspace ? "no-readable-saved-port" : "no-matching-workspace" };
  } catch { return { target: null, reason: "workspace-storage-unavailable" }; }
}

function connectVscode(cwd: string, handlers: {
  onContext: (data: Ctx) => void;
  onInject: (text: string) => void;
  onDisconnect: () => void;
}): LiveLink | null {
  const explicit = process.env[PORT_ENV];
  if (!explicit && !(process.env.HERDR_ENV === "1" && ["darwin", "win32"].includes(process.platform))) return null;

  let resolveReady!: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  const link: LiveLink = {
    diagnostic: { source: explicit ? PORT_ENV : "Herdr workspaceStorage", reason: "connecting" },
    ready, latest: null, send: () => false, connected: () => false, stop: () => {},
  };
  let socket: net.Socket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frameDeadline: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const retry = () => { if (!stopped) timer = setTimeout(dial, 1000).unref(); };
  const dial = () => {
    if (stopped) return;
    // Re-read on reconnect: VS Code can choose a new port after a restart.
    const port = explicit ? validPort(explicit) : null;
    const discovery = explicit
      ? { target: port ? { port, workspace: null } : null, reason: port ? "connecting" : "invalid-port" }
      : discoverVscode(cwd);
    link.diagnostic.reason = discovery.reason;
    const target = discovery.target;
    if (!target) { resolveReady(); retry(); return; }
    const client = net.connect(target.port, "127.0.0.1");
    socket = client;
    let buffer = "";
    client.setEncoding("utf8");
    // Absolute deadlines, rather than inactivity: trickled bytes cannot extend them.
    frameDeadline = setTimeout(() => { link.diagnostic.reason = "handshake-timeout"; client.destroy(); }, 3000).unref();
    client.on("data", (chunk: string) => {
      if (stopped) return;
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) { link.diagnostic.reason = "oversized-frame"; client.destroy(); return; }
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "context") {
            if (!isContext(msg.data)) { link.diagnostic.reason = "invalid-context"; client.destroy(); return; }
            // A saved port can be stale/reused. Verify the project before exposing data.
            if (typeof msg.data.workspace !== "string") { client.destroy(); return; }
            const workspace = fs.realpathSync(msg.data.workspace);
            if (!insideWorkspace(workspace, fs.realpathSync(cwd)) ||
                (target.workspace && path.relative(target.workspace, workspace) !== "")) {
              link.diagnostic.reason = "workspace-mismatch";
              client.destroy(); return;
            }
            clearTimeout(frameDeadline);
            frameDeadline = undefined;
            link.latest = msg.data;
            link.diagnostic.reason = "connected";
            resolveReady();
            handlers.onContext(msg.data);
          } else if (msg.type === "inject" && link.latest && typeof msg.text === "string") {
            handlers.onInject(msg.text);
          }
        } catch { link.diagnostic.reason = "invalid-context"; client.destroy(); return; }
      }
      if (link.latest && !buffer.length) {
        clearTimeout(frameDeadline);
        frameDeadline = undefined;
      } else if (buffer.length && !frameDeadline) {
        frameDeadline = setTimeout(() => { link.diagnostic.reason = "frame-timeout"; client.destroy(); }, 3000).unref();
      }
    });
    client.on("close", () => {
      clearTimeout(frameDeadline);
      frameDeadline = undefined;
      resolveReady();
      socket = undefined;
      link.latest = null;
      if (link.diagnostic.reason === "connected") link.diagnostic.reason = "bridge-disconnected";
      if (!stopped) { handlers.onDisconnect(); retry(); }
    });
    client.on("error", (error: NodeJS.ErrnoException) => {
      link.diagnostic.reason = error.code === "ECONNREFUSED" ? "connection-refused" : "socket-error";
      client.destroy();
    });
  };
  link.connected = () => !!socket && socket.readyState === "open" && !!link.latest;
  link.send = (msg) => link.connected() ? socket!.write(JSON.stringify(msg) + "\n") : false;
  link.stop = () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(frameDeadline);
    resolveReady();
    link.latest = null;
    socket?.destroy();
  };
  dial();
  return link;
}

export function registerEditorContext(pi: ExtensionAPI) {
  let lastInjectedHash = "";
  let link: LiveLink | null = null;
  const NO_LINK = "Not connected to VSCode. Run /vscode doctor for a local connection report. Open this project in VSCode with Pi Agent Bridge enabled. Herdr discovery supports stable Code on macOS/Windows; other setups need PI_VSCODE_PORT and a matching workspace.";

  // ---- Live footer status + socket link ----
  pi.on("session_start", async (_event, ctx) => {
    const setStatus = (value: string | undefined) => {
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, value);
    };
    link?.stop();
    if (ctx.hasUI) ctx.ui.setWidget(STATUS_KEY, undefined);
    setStatus(undefined);
    lastInjectedHash = "";
    autoInject = true;
    let receivedContext = false;
    link = connectVscode(ctx.cwd, {
      onContext: (data) => {
        if (!data.activeFile && !data.selection?.selections.length) lastInjectedHash = "";
        receivedContext = true;
        setStatus(statusLine(data));
      },
      onDisconnect: () => {
        lastInjectedHash = "";
        setStatus(receivedContext ? "vscode: disconnected; reconnecting…" : undefined);
      },
      onInject: (text) => {
        if (!ctx.hasUI) return;
        // setEditorText replaces the buffer; append to preserve any draft.
        const existing = ctx.ui.getEditorText?.() ?? "";
        const next = existing ? `${existing} ${text}` : text;
        ctx.ui.setEditorText(next);
      },
    });

  });

  pi.on("session_shutdown", async (_event, ctx) => {
    link?.stop();
    link = null;
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  let autoInject = true;

  // Build a compact, selection-focused payload. Null when nothing worth sending.
  const buildInjection = (data: Ctx): string | null => {
    const sel = data.selection;
    if (sel && sel.selections.length > 0) {
      const parts: string[] = [];
      parts.push(`User is in \`${sel.path}\` (cursor line ${sel.cursorLine}).`);
      for (const s of sel.selections) {
        const range = s.startLine === s.endLine ? `line ${s.startLine}` : `lines ${s.startLine}-${s.endLine}`;
        parts.push(`Selected ${range}${s.truncated ? " (truncated)" : ""}:`);
        parts.push("```" + sel.languageId);
        parts.push(s.text);
        parts.push("```");
      }
      parts.push("(Full open-file list available via the vscode_context tool.)");
      return parts.join("\n");
    }
    if (data.activeFile) {
      return `User is focused on \`${data.activeFile}\` (no selection). Use the vscode_context tool for open files.`;
    }
    return null;
  };

  // A branch change or compaction can remove the prior hidden attachment.
  pi.on("session_tree", () => { lastInjectedHash = ""; });
  pi.on("session_compact", () => { lastInjectedHash = ""; });

  // ---- Smart auto-injection: attach active file + selection to each turn ----
  pi.on("before_agent_start", async (_event, _ctx) => {
    if (!autoInject) return;
    await link?.ready;
    const data = link?.latest;
    if (!data) return;
    const payload = buildInjection(data);
    if (!payload) return;

    // Dedupe: skip if identical to what we injected last turn (saves tokens;
    // the model still has the previous copy in context).
    const hash = crypto.createHash("sha1").update(payload).digest("hex");
    if (hash === lastInjectedHash) return;
    lastInjectedHash = hash;

    return {
      message: {
        customType: "vscode-context",
        content: `Current VSCode editor state (auto-attached):\n\n${payload}`,
        display: false,
      },
    };
  });

  // ---- Toggle auto-injection ----
  pi.registerCommand("vscode-auto", {
    description: "Toggle auto-injection of VSCode context (on|off)",
    handler: async (args, ctx) => {
      const a = (args || "").trim().toLowerCase();
      autoInject = a === "on" ? true : a === "off" ? false : !autoInject;
      lastInjectedHash = "";
      ctx.ui.notify(`VSCode auto-inject ${autoInject ? "on" : "off"}`, "info");
    },
  });

  // ---- Open a file in VSCode at a specific line/range ----
  pi.registerTool({
    name: "open_in_editor",
    label: "Open in VSCode",
    description:
      "Open a file in the user's VSCode window and put the cursor on a line. " +
      "Use when you want to show the user a specific location in a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path (absolute, or relative to the project root)" },
        line: { type: "number", description: "1-based line number to jump to (optional)" },
        endLine: { type: "number", description: "1-based end line to select through (optional)" },
        column: { type: "number", description: "1-based column (optional)" },
      },
      required: ["path"],
    } as never,
    async execute(_id: unknown, params: { path: string; line?: number; endLine?: number; column?: number }) {
      const where = params.line ? `${params.path}:${params.line}` : params.path;
      const sent = link?.connected() && link.send({
        type: "open",
        path: params.path,
        line: params.line,
        endLine: params.endLine,
        column: params.column,
      });
      return {
        content: [{ type: "text", text: sent ? `Opened ${where} in VSCode.` : NO_LINK }],
        details: { via: "socket", sent: !!sent },
      };
    },
  });

  // ---- On-demand tool the agent can call itself ----
  pi.registerTool({
    name: "vscode_context",
    label: "VSCode context",
    description:
      "Read the user's current VSCode editor state: active file, open files, " +
      "and selected lines of code. Use this to know what the user is looking at.",
    parameters: { type: "object", properties: {} } as never,
    async execute() {
      const data = link?.latest;
      if (!data) return { content: [{ type: "text", text: NO_LINK }], details: {} };
      return { content: [{ type: "text", text: renderMarkdown(data) }], details: {} };
    },
  });

  // ---- Manual command to inject context on demand ----
  pi.registerCommand("vscode", {
    description: "Inject current VSCode editor context, or run /vscode doctor for local diagnostics",
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() === "doctor") {
        await link?.ready;
        ctx.ui.notify([
          `Pi cwd: ${ctx.cwd}`,
          `Discovery: ${link?.diagnostic.source ?? "disabled"}`,
          `Result: ${link?.connected() ? "connected" : "unavailable"}`,
          `Reason: ${link?.diagnostic.reason ?? "no direct port and no supported Herdr discovery environment"}`,
          link?.connected() ? "Next: select text, then send your question. Selection changes alone send no model message."
            : link?.diagnostic.reason === "invalid-port" || link?.diagnostic.reason === "connection-refused"
              ? "Next: reopen a VS Code integrated terminal for a current port. In Herdr, an absent PI_VSCODE_PORT enables workspace discovery."
              : "Next: open this folder in one stable VS Code window with Pi Agent Bridge enabled. /reload does not change Pi cwd.",
        ].join("\n"), "info");
        return;
      }
      const data = link?.latest;
      if (!data) {
        ctx.ui.notify(NO_LINK, "warning");
        return;
      }
      await pi.sendMessage({
        customType: "vscode-context",
        content: `Here is my current VSCode editor context:\n\n${renderMarkdown(data)}`,
        display: true,
      });
    },
  });
}
