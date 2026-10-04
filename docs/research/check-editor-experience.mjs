// Run: node --experimental-strip-types docs/research/check-editor-experience.mjs [companion.ts]
// Reuses the local vscode-herdr regression fixture. macOS only (workspace storage + sqlite3).
// Synthetic editor + independent extension instances + real loopback IPC.
// This does not launch Pi/Herdr or prove terminal reattachment / visual rendering.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.platform, 'darwin', 'This fixture checks the macOS companion; Windows needs its own validation.');
const extension = process.argv[2] || `${process.env.HOME}/.pi/agent/extensions/pi-vscode-context.ts`;
const install = (await import(pathToFileURL(extension).href)).default;
const home = mkdtempSync(join(tmpdir(), 'pi-vscode-herdr-'));
const cwd = join(home, 'project 中文');
mkdirSync(cwd);
const storage = join(home, 'Library/Application Support/Code/User/workspaceStorage');
process.env.HOME = home;
process.env.HERDR_ENV = '1';
delete process.env.PI_VSCODE_PORT;
const clients = new Set();
const data = { workspace: cwd, activeFile: 'sample.tex', openFiles: [], selection: {
  path: 'sample.tex', languageId: 'latex', cursorLine: 41,
  selections: [{ startLine: 41, endLine: 42, text: 'synthetic selected paragraph', truncated: false }],
} };
const server = net.createServer(socket => {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => {});
  socket.write(JSON.stringify({ type: 'context', data }) + '\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
function descriptor(id, folder, p = port) {
  const dir = join(storage, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(folder).href }));
  execFileSync('/usr/bin/sqlite3', [join(dir, 'state.vscdb'),
    `CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE, value TEXT); INSERT OR REPLACE INTO ItemTable VALUES ('zenyui.vscode-pi-bridge', '{"piContext.port":${p}}');`]);
}
let active;
const sessions = new Set();
async function start(dir = cwd) {
  const session = { events: {}, tools: {}, status: undefined, messages: [], draft: 'existing prompt' };
  session.ui = {
    setStatus(key, value) { assert.equal(key, 'vscode'); session.status = value; },
    setWidget(_key, value) { assert.equal(value, undefined, 'VS Code status belongs below the input, not in a widget'); },
    setFooter() { assert.fail('native footer must remain intact'); },
    getEditorText: () => session.draft,
    setEditorText(value) { session.draft = value; },
  };
  install({
    on: (name, fn) => { session.events[name] = fn; },
    registerTool: t => { session.tools[t.name] = t; },
    registerCommand() {},
    sendMessage: message => session.messages.push(message),
    sendUserMessage: message => session.messages.push(message),
  });
  sessions.add(session);
  active = session;
  await session.events.session_start({}, { cwd: dir, hasUI: true, ui: session.ui });
  return session;
}
const context = async (session = active) => (await session.tools.vscode_context.execute()).content[0].text;
async function stop(session = active) {
  if (!session || !sessions.has(session)) return;
  await session.events.session_shutdown({}, { hasUI: true, ui: session.ui });
  sessions.delete(session);
  await delay(30);
}
async function waitFor(predicate, message) {
  for (let i = 0; i < 60; i++) { if (await predicate()) return; await delay(50); }
  assert.fail(message);
}
try {
  descriptor('match', cwd);
  await start();
  await waitFor(async () => (await context()).includes('synthetic selected paragraph'), 'Herdr without PI_VSCODE_PORT must recover the matching workspace selection');
  assert.match(await context(), /lines 41-42/);
  assert.equal(active.status, 'vscode: sample.tex L41-42');
  assert.match((await active.events.before_agent_start({}, {})).message.content, /synthetic selected paragraph/);
  assert.equal(await active.events.before_agent_start({}, {}), undefined, 'unchanged selection should deduplicate');
  for (const client of clients) client.destroy();
  await delay(50);
  assert.doesNotMatch(await context(), /synthetic selected paragraph/, 'disconnect must discard cached selection');
  assert.equal(active.status, 'vscode: disconnected; reconnecting…', 'a previously connected writing session should retain a brief disconnect notice');
  await waitFor(async () => (await context()).includes('synthetic selected paragraph'), 'reconnect must recover');
  const replacement = net.createServer(server.listeners('connection')[0]);
  await new Promise(resolve => replacement.listen(0, '127.0.0.1', resolve));
  try {
    descriptor('match', cwd, replacement.address().port);
    for (const client of clients) client.destroy();
    await delay(50);
    await waitFor(() => [...clients].some(c => c.localPort === replacement.address().port), 'reconnect must re-read the saved port');
    await waitFor(async () => (await context()).includes('synthetic selected paragraph'), 'replacement bridge context must arrive');
    await stop();
  } finally {
    for (const client of clients) client.destroy();
    await new Promise(resolve => replacement.close(resolve));
    descriptor('match', cwd);
  }
  assert.equal(clients.size, 0, 'shutdown must close the connection');
  assert.equal(active.status, undefined, 'shutdown must clear the footer status');
  await delay(1100);
  assert.equal(clients.size, 0, 'shutdown must cancel reconnect');

  const nested = join(cwd, 'nested'); mkdirSync(nested);
  await start(nested);
  await waitFor(async () => (await context()).includes('synthetic selected paragraph'), 'project subdirectories should resolve');
  await stop();

  descriptor('second', cwd);
  await start(); await delay(200);
  assert.doesNotMatch(await context(), /synthetic selected paragraph/, 'ambiguous matching windows must fail closed');
  await stop();
  rmSync(join(storage, 'second'), { recursive: true });

  data.workspace = join(home, 'other-project');
  await start(); await delay(200);
  assert.doesNotMatch(await context(), /synthetic selected paragraph/, 'stale port for another workspace must be rejected');
  assert.equal(active.status, undefined, 'rejected context must not create a disconnected status in a never-connected session');
  await stop(); data.workspace = cwd;

  await start(`${cwd}-other`); await delay(200);
  assert.doesNotMatch(await context(), /synthetic selected paragraph/, 'directory prefix alone must not match');
  await stop();

  delete process.env.HERDR_ENV;
  await start(); await delay(200);
  assert.doesNotMatch(await context(), /synthetic selected paragraph/, 'no implicit discovery outside Herdr');
  await stop();
  process.env.PI_VSCODE_PORT = String(port);
  await start();
  await waitFor(async () => (await context()).includes('synthetic selected paragraph'), 'explicit terminal port must retain existing behavior');
  await stop();
  console.log('PASS: existing discovery, attachment, reconnect, cleanup and native status regression checks');

  // No terminal-switch lifecycle event is sent: the writer is the SAME live Pi instance.
  // Starting siblings with WezTerm's inherited environment exercises independent sessions,
  // not an actual GUI switch. Real Herdr reattachment stays on the manual checklist.
  process.env.HERDR_ENV = '1';
  process.env.TERM_PROGRAM = 'WezTerm';
  delete process.env.PI_VSCODE_PORT;
  const writer = await start();
  const sibling = await start();
  await waitFor(async () => (await context(writer)).includes('synthetic selected paragraph') &&
    (await context(sibling)).includes('synthetic selected paragraph'), 'both same-project sessions should receive editor context');
  assert.match((await writer.events.before_agent_start({}, {})).message.content, /synthetic selected paragraph/);
  assert.match((await sibling.events.before_agent_start({}, {})).message.content, /synthetic selected paragraph/);
  await stop(sibling);
  data.selection.selections = [{ startLine: 70, endLine: 72, text: 'next selected paragraph', truncated: false }];
  for (const client of clients) client.write(JSON.stringify({ type: 'context', data }) + '\n');
  await waitFor(async () => (await context(writer)).includes('next selected paragraph'), 'closing sibling must leave writer receiving fresh selections');
  assert.equal(writer.status, 'vscode: sample.tex L70-72');
  assert.match((await writer.events.before_agent_start({}, {})).message.content, /next selected paragraph/);
  const reopened = await start();
  await waitFor(async () => (await context(reopened)).includes('next selected paragraph'), 'another sibling can start while the writer stays live');
  await stop(reopened);
  data.selection.selections = [];
  for (const client of clients) client.write(JSON.stringify({ type: 'context', data }) + '\n');
  await waitFor(() => writer.status === 'vscode: sample.tex (no selection)', 'clearing selection should update native status');
  const cleared = (await writer.events.before_agent_start({}, {})).message.content;
  assert.match(cleared, /no selection/);
  assert.doesNotMatch(cleared, /next selected paragraph/);
  assert.equal(writer.draft, 'existing prompt', 'editor changes must preserve the prompt');
  assert.deepEqual(writer.messages, [], 'editor changes must not send model messages');
  for (const client of clients) client.destroy();
  await new Promise(resolve => server.close(resolve));
  await waitFor(async () => (await context(writer)).includes('Not connected'), 'closing editor must invalidate current context');
  assert.equal(await writer.events.before_agent_start({}, {}), undefined, 'closed editor must stop context attachment');
  await stop(writer);
  console.log('PASS: same-project siblings can open/close; writer stays live, no-selection status updates, editor close clears context');

  const unrelated = join(home, 'daily-project'); mkdirSync(unrelated);
  const daily = await start(unrelated);
  assert.equal(await daily.events.before_agent_start({}, {}), undefined, 'unrelated project must not attach editor context');
  assert.match(await context(daily), /Not connected/);
  console.log('PASS: unrelated project receives no editor content');
  await delay(1100); // Observe beyond the installed companion's first retry as well as startup.
  assert.equal(daily.status, undefined, 'unrelated daily project must not display a phantom vscode: connecting status');
  console.log('PASS: unrelated daily project stays visually quiet');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const session of [...sessions]) await stop(session);
  for (const socket of clients) socket.destroy();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  rmSync(home, { recursive: true, force: true });
}
// The old companion leaves retry timers alive; make its failing regression bounded.
process.exit(process.exitCode || 0);
