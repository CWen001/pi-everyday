// Reproduce the reviewed bridge's compatibility gate using synthetic editor text.
// Usage: node docs/research/check-editor-bridge.mjs <reviewed-vscode-pi-checkout>
// Runs reviewed upstream code; the VM loader is not a security sandbox.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.argv[2];
if (!root) throw new Error('Pass a reviewed zenyui/vscode-pi checkout; see editor-context-compatibility.md.');
const hashes = new Map([
  ['extension.ts', 'de6e83903a3e0d31aee6e1ed4df5baeab0ac24ea60f2c67b2be66ce6ec69d2a4'],
  ['ipc.ts', '20f46e8ffa0abb9dad65478fb1ddd716674f83c18080ae6bb6a50b1425785cd9'],
]);
const require = createRequire(import.meta.url);
const inert = () => ({ dispose() {} });
const commands = new Map();
const settings = { enabled: true, autoInstallCompanion: false, maxSelectionLines: 400 };
const folder = path.resolve('synthetic-editor-project');
const selection = { isEmpty: false, start: { line: 40, character: 0 }, end: { line: 41, character: 4 }, active: { line: 41, character: 4 } };
const document = { uri: { scheme: 'file', fsPath: path.join(folder, 'paper.tex') }, languageId: 'latex', getText: () => 'SYNTHETIC SELECTION' };
let port;
const vscode = {
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => settings[key] ?? fallback,
      update: async (key, value) => { settings[key] = value; },
    }),
    workspaceFolders: [{ uri: { fsPath: folder } }], textDocuments: [document],
    onDidSaveTextDocument: inert, onDidChangeConfiguration: inert,
  },
  window: {
    activeTextEditor: { document, selection, selections: [selection] },
    tabGroups: { all: [], onDidChangeTabs: inert },
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    onDidChangeActiveTextEditor: inert, onDidChangeTextEditorSelection: inert,
    showWarningMessage() {},
  },
  commands: { registerCommand: (name, handler) => { commands.set(name, handler); return inert(); } },
  StatusBarAlignment: { Right: 1 }, ConfigurationTarget: { Global: 1 },
};
function load(name) {
  const source = readFileSync(path.join(root, 'src', name), 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), hashes.get(name), `Review changed upstream source before running: ${name}`);
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const dependency = id => {
    if (id === 'vscode') return vscode;
    if (id === './ipc') return load('ipc.ts');
    assert(['fs', 'os', 'path', 'net'].includes(id), `Unexpected dependency: ${id}`);
    return require(`node:${id}`);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: name })(dependency, module, module.exports);
  return module.exports;
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10); }
  throw new Error('Probe timed out before expected bridge data arrived.');
}
const clients = [];
async function connect() {
  const socket = net.connect(port, '127.0.0.1');
  const client = { socket, messages: [], error: null };
  clients.push(client);
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('error', error => { client.error = error; });
  socket.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { client.messages.push(JSON.parse(line)); } catch (error) { client.error = error; }
    }
  });
  // The client deliberately sends no request or credentials.
  await until(() => client.messages.length > 0 || client.error);
  if (client.error) throw client.error;
  return client;
}
const extension = load('extension.ts');
const context = {
  subscriptions: [],
  workspaceState: { get: () => undefined, update() {} },
  environmentVariableCollection: { replace: (_name, value) => { port = Number(value); } },
};
try {
  extension.activate(context);
  await until(() => !!port);
  const first = await connect();
  assert.equal(first.messages[0].data.selection.selections[0].text, 'SYNTHETIC SELECTION');
  const count = first.messages.length;
  commands.get('piContext.toggle')();
  assert.equal(settings.enabled, false);
  await delay(200);
  const messagesDuringPause = first.messages.slice(count).map(message => message.type);
  const second = await connect();
  const contextDeliveredWhilePaused = second.messages.some(message => message.type === 'context');
  commands.get('piContext.sendToPi')();
  await until(() => clients.every(client => client.messages.some(message => message.type === 'inject')));
  console.log(JSON.stringify({
    upstreamCommit: 'ec553e0699b9a93b143a52b9066621156e6ce740',
    syntheticEditor: true,
    clientSentCredentials: false,
    initialContextDelivered: first.messages[0].type === 'context',
    sharingEnabledAfterToggle: settings.enabled,
    messagesDuringPause,
    pauseObservationMs: 200,
    contextDeliveredWhilePaused,
    sendSelectionDeliveredToClients: clients.filter(client => client.messages.some(message => message.type === 'inject')).length,
    gate: contextDeliveredWhilePaused ? 'BLOCKED' : 'REVIEW_REQUIRED',
  }, null, 2));
  process.exitCode = 1; // A reproduced blocker or changed behavior requires review, never an automatic pass.
} finally {
  for (const client of clients) client.socket.destroy();
  extension.deactivate();
  for (const subscription of context.subscriptions) subscription.dispose?.();
}
