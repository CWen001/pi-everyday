import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerEditorContext } from "../src/editor-context.ts";
import piEveryday from "../extensions/index.ts";

test("the Pi package entry registers editor tools and commands exactly once", async () => {
  const tools: string[] = [];
  const commands: string[] = [];
  const shutdown: Array<(...args: any[]) => any> = [];
  piEveryday({
    on(name: string, handler: (...args: any[]) => any) { if (name === "session_shutdown") shutdown.push(handler); },
    registerTool(tool: { name: string }) { tools.push(tool.name); },
    registerCommand(name: string) { commands.push(name); },
    registerMarkdownTransformer() {},
  } as unknown as ExtensionAPI);
  assert.deepEqual(tools.sort(), ["open_in_editor", "vscode_context"]);
  assert.deepEqual(commands.sort(), ["vscode", "vscode-auto"]);
  for (const stop of shutdown) await stop({}, { hasUI: false });
});

// The real registration Interface, with only Pi's host callbacks substituted.
function session(cwd: string, hasUI = true) {
  type Handler = (...args: any[]) => any;
  const events = new Map<string, Handler>();
  const tools = new Map<string, { execute: Handler }>();
  const commands = new Map<string, { handler: Handler }>();
  const statuses: Array<string | undefined> = [];
  const messages: unknown[] = [];
  const notices: string[] = [];
  let draft = "existing draft";
  const ui = {
    setStatus(key: string, value: string | undefined) { assert.equal(key, "vscode"); statuses.push(value); },
    setWidget(_key: string, value: unknown) { assert.equal(value, undefined); },
    setFooter() { assert.fail("preserve native footer"); },
    getEditorText: () => draft,
    setEditorText(value: string) { draft = value; },
    notify(text: string) { notices.push(text); },
  };
  const ctx = { cwd, hasUI, ui } as unknown as ExtensionContext;
  registerEditorContext({
    on: (name: string, handler: Handler) => events.set(name, handler),
    registerTool: (tool: { name: string; execute: Handler }) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command),
    sendMessage: (message: unknown) => messages.push(message),
    sendUserMessage: (message: unknown) => messages.push(message),
  } as unknown as ExtensionAPI);
  return {
    ctx, events, tools, commands, statuses, messages, notices,
    draft: () => draft,
    start: () => events.get("session_start")!({}, ctx),
    stop: () => events.get("session_shutdown")!({}, ctx),
    read: async () => (await tools.get("vscode_context")!.execute()).content[0].text as string,
    attach: () => events.get("before_agent_start")!({}, ctx),
  };
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string) {
  for (let i = 0; i < 120; i++) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail(label);
}

test("local diagnostics explain a missing editor without sending a model message", async (t) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-editor-doctor-")));
  const env = { ...process.env };
  delete process.env.PI_VSCODE_PORT;
  delete process.env.HERDR_ENV;
  const s = session(cwd);
  t.after(async () => {
    await s.stop();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    rmSync(cwd, { recursive: true, force: true });
  });
  await s.start();
  await s.commands.get("vscode")!.handler("doctor", s.ctx);
  assert.match(s.notices.at(-1)!, /Pi cwd:/);
  assert.ok(s.notices.at(-1)!.includes(cwd));
  assert.match(s.notices.at(-1)!, /no direct port.*Herdr/i);
  assert.deepEqual(s.messages, [], "diagnostics must not become model context");
  assert.equal(s.statuses.at(-1), undefined, "no editor remains quiet during normal use");
});

test("editor context via the Pi tool/event Seam", { timeout: 40000 }, async (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "pi-editor-")));
  const cwd = join(home, "论文 project"); mkdirSync(cwd);
  const env = { ...process.env };
  const clients = new Set<net.Socket>();
  const requests: unknown[] = [];
  const publish = (value: unknown) => {
    for (const c of clients) c.write(JSON.stringify({ type: "context", data: value }) + "\n");
  };
  const data = { workspace: cwd, activeFile: "draft.tex", openFiles: [], selection: {
    path: "draft.tex", languageId: "latex", cursorLine: 12,
    selections: [{ startLine: 12, endLine: 14, text: "所选段落", truncated: false }],
  } };
  let initialSnapshot = true;
  const server = net.createServer(socket => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => {});
    let buffer = "";
    socket.on("data", chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        requests.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1);
      }
    });
    if (initialSnapshot) socket.write(JSON.stringify({ type: "context", data }) + "\n");
  });
  const sessions: ReturnType<typeof session>[] = [];
  t.after(async () => {
    for (const s of sessions) await s.stop();
    for (const c of clients) c.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    rmSync(home, { recursive: true, force: true });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  process.env.PI_VSCODE_PORT = String((server.address() as net.AddressInfo).port);
  const writer = session(cwd); sessions.push(writer);
  await writer.start();
  await waitFor(async () => (await writer.read()).includes("所选段落"), "context arrives");
  assert.equal(writer.statuses.at(-1), "vscode: draft.tex L12-14");
  assert.match((await writer.attach()).message.content, /所选段落/);
  assert.equal(await writer.attach(), undefined, "unchanged attachment is deduplicated");
  assert.deepEqual(writer.messages, [], "editor changes send no model messages");

  await t.test("headless Pi receives context without using terminal UI", async () => {
    const headless = session(cwd, false); sessions.push(headless);
    headless.ctx.ui = new Proxy({} as typeof headless.ctx.ui, { get() { assert.fail("headless session must not use UI"); } });
    await headless.start();
    assert.match((await headless.attach()).message.content, /所选段落/, "an immediate first prompt waits for initial context");
    for (const c of clients) c.write(JSON.stringify({ type: "inject", text: "headless mention" }) + "\n");
    await delay(50); // The headless UI proxy must remain untouched by inject frames.
    await headless.stop();
  });

  await t.test("an inherited explicit port cannot expose another project", async () => {
    const other = join(home, "daily"); mkdirSync(other);
    const s = session(other); sessions.push(s);
    await s.start(); await delay(200);
    assert.match(await s.read(), /Not connected/);
    assert.equal(await s.attach(), undefined);
    assert.equal(s.statuses.at(-1), undefined);
    await s.commands.get("vscode")!.handler("doctor", s.ctx);
    assert.match(s.notices.at(-1)!, /workspace-mismatch/);
    assert.doesNotMatch(s.notices.at(-1)!, /所选段落/);
    await s.stop();
  });

  await t.test("siblings, commands and draft preservation use independent live sessions", async () => {
    const s = session(cwd); sessions.push(s);
    await s.start(); await waitFor(async () => (await s.read()).includes("所选段落"), "sibling connects");
    assert.match((await s.attach()).message.content, /所选段落/);
    await s.stop();
    publish({ ...data, selection: { ...data.selection, selections: [] } });
    await waitFor(() => writer.statuses.at(-1) === "vscode: draft.tex (no selection)", "no selection status");
    assert.match((await writer.attach()).message.content, /no selection/);
    await writer.commands.get("vscode-auto")!.handler("off", writer.ctx);
    publish(data); await waitFor(async () => (await writer.read()).includes("所选段落"), "writer survives sibling shutdown");
    assert.equal(await writer.attach(), undefined, "auto off stops attachment, explicit reads stay available");
    await writer.commands.get("vscode-auto")!.handler("on", writer.ctx);
    assert.match((await writer.attach()).message.content, /所选段落/);
    const opened = await writer.tools.get("open_in_editor")!.execute("id", { path: "draft.tex", line: 12 });
    assert.equal(opened.details.sent, true);
    await waitFor(() => requests.length > 0, "file navigation reaches bridge");
    assert.deepEqual(requests.at(-1), { type: "open", path: "draft.tex", line: 12 });
    assert.equal(writer.draft(), "existing draft headless mention");
    for (const c of clients) c.write(JSON.stringify({ type: "inject", text: "new mention" }) + "\n");
    await waitFor(() => writer.draft() === "existing draft headless mention new mention", "inject appends without replacing draft");
    assert.deepEqual(writer.messages, []);
  });

  await t.test("empty editor invalidates attachment deduplication", async () => {
    publish({ ...data, activeFile: null, selection: null });
    await waitFor(() => writer.statuses.at(-1) === "vscode: no file", "empty editor arrives");
    publish(data); await waitFor(() => writer.statuses.at(-1) === "vscode: draft.tex L12-14", "same selection restored");
    assert.match((await writer.attach()).message.content, /所选段落/, "restored selection attaches even without an intervening user turn");
  });

  await t.test("invalid context clears the current snapshot; reconnect recovers", async () => {
    publish({ ...data, openFiles: [null] });
    await waitFor(async () => (await writer.read()).includes("Not connected"), "invalid input discards current snapshot");
    assert.equal(await writer.attach(), undefined);
    await waitFor(async () => (await writer.read()).includes("所选段落"), "reconnection restores valid context");
  });

  await t.test("new conversation resets its auto-attachment switch", async () => {
    await writer.commands.get("vscode-auto")!.handler("off", writer.ctx);
    await writer.start();
    await waitFor(async () => (await writer.read()).includes("所选段落"), "new conversation connected");
    assert.match((await writer.attach()).message.content, /所选段落/);
  });

  await t.test("tree navigation and compaction invalidate attachment deduplication", async () => {
    for (const event of ["session_tree", "session_compact"]) {
      await writer.events.get(event)!({}, writer.ctx);
      assert.match((await writer.attach()).message.content, /所选段落/);
      assert.equal(await writer.attach(), undefined);
    }
  });

  await t.test("an absolute handshake deadline defeats trickling input", async () => {
    initialSnapshot = false;
    const before = new Set(clients);
    const s = session(cwd); sessions.push(s);
    let trickle: ReturnType<typeof setInterval> | undefined;
    try {
      await s.start();
      await waitFor(() => [...clients].some(c => !before.has(c)), "silent bridge accepts client");
      const socket = [...clients].find(c => !before.has(c))!;
      trickle = setInterval(() => { if (!socket.destroyed) socket.write(" "); }, 100);
      await waitFor(() => socket.destroyed, "initial deadline closes an unvalidated trickling peer");
      assert.equal(await s.attach(), undefined);
      assert.equal(s.statuses.at(-1), undefined);
    } finally {
      clearInterval(trickle); initialSnapshot = true; await s.stop();
    }
  });

  await t.test("an incomplete frame invalidates stale context after its deadline", async () => {
    for (const c of clients) c.write('{"type":');
    await waitFor(async () => (await writer.read()).includes("Not connected"), "partial frame deadline clears context");
    assert.equal(await writer.attach(), undefined);
    await waitFor(async () => (await writer.read()).includes("所选段落"), "valid context recovers after deadline");
  });

  await t.test("Herdr discovers one native workspace, stays quiet elsewhere, rejects ambiguity", {
    skip: process.platform !== "darwin" && process.platform !== "win32",
  }, async () => {
    delete process.env.PI_VSCODE_PORT;
    process.env.HERDR_ENV = "1";
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.APPDATA = join(home, "AppData", "Roaming");
    const storage = process.platform === "win32"
      ? join(process.env.APPDATA, "Code", "User", "workspaceStorage")
      : join(home, "Library", "Application Support", "Code", "User", "workspaceStorage");
    const descriptor = (id: string) => {
      const dir = join(storage, id); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "workspace.json"), JSON.stringify({ folder: pathToFileURL(cwd).href }));
      execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", `
        const {DatabaseSync}=require('node:sqlite');
        const db=new DatabaseSync(process.argv[1]);
        db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE, value TEXT)');
        db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('zenyui.vscode-pi-bridge', process.argv[2]);
        db.close();
      `, join(dir, "state.vscdb"), JSON.stringify({ "piContext.port": (server.address() as net.AddressInfo).port })]);
    };
    descriptor("one");
    const nested = join(cwd, "nested"); mkdirSync(nested);
    const s = session(nested); sessions.push(s);
    await s.start();
    await waitFor(async () => (await s.read()).includes("所选段落"), "unique native workspace discovered");
    await s.stop();
    const other = session(join(home, "daily")); sessions.push(other);
    await other.start(); await delay(150);
    assert.equal(other.statuses.at(-1), undefined);
    assert.equal(await other.attach(), undefined);
    await other.commands.get("vscode")!.handler("doctor", other.ctx);
    assert.match(other.notices.at(-1)!, /no-matching-workspace/);
    await other.stop();
    descriptor("two");
    const ambiguous = session(cwd); sessions.push(ambiguous);
    await ambiguous.start(); await delay(150);
    assert.match(await ambiguous.read(), /Not connected/);
    assert.equal(ambiguous.statuses.at(-1), undefined);
    await ambiguous.commands.get("vscode")!.handler("doctor", ambiguous.ctx);
    assert.match(ambiguous.notices.at(-1)!, /ambiguous-workspace/);
    await ambiguous.stop();
  });

  await t.test("closing the editor invalidates context and leaves Pi usable", async () => {
    for (const c of clients) c.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await waitFor(async () => (await writer.read()).includes("Not connected"), "closed editor invalidates current context");
    assert.equal(await writer.attach(), undefined);
    assert.equal(writer.statuses.at(-1), "vscode: disconnected; reconnecting…");
    await writer.stop();
    assert.equal(writer.statuses.at(-1), undefined);
    await delay(1100);
    assert.equal(clients.size, 0, "shutdown cancels reconnect");
    assert.match(await writer.read(), /Not connected/);
  });
});
