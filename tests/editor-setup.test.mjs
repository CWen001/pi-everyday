import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const setup = fileURLToPath(new URL("../src/editor-setup.mjs", import.meta.url));
const fixture = readFileSync(new URL("./fixtures/bridge-0.0.3.txt", import.meta.url), "utf8");

function sandbox(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-editor-setup-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const project = join(home, "project 中文");
  mkdirSync(project);
  const agentDir = join(home, ".pi", "agent");
  const userDir = process.platform === "win32"
    ? join(home, "AppData", "Roaming", "Code", "User")
    : process.platform === "darwin"
      ? join(home, "Library", "Application Support", "Code", "User")
      : join(home, ".config", "Code", "User");
  const env = { ...process.env, HOME: home, USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"), XDG_CONFIG_HOME: join(home, ".config"),
    PI_CODING_AGENT_DIR: agentDir, INIT_CWD: project };
  const put = (path, content) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content); };
  const run = () => spawnSync(process.execPath, [setup], { cwd: project, env, encoding: "utf8", timeout: 10000 });
  return { home, project, agentDir, userDir, env, put, run };
}

function config(path) {
  const result = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
  assert.equal(result.error, undefined);
  return result.config;
}

test("editor setup removes verified duplicate files before Pi loads extensions", async (t) => {
  const s = sandbox(t);
  const globalFile = join(s.agentDir, "extensions", "pi-vscode-context.ts");
  const projectFile = join(s.project, ".pi", "extensions", "pi-vscode-context.ts");
  const userSettings = join(s.userDir, "settings.json");
  s.put(globalFile, fixture.replace(/\r?\n/g, "\r\n"));
  s.put(projectFile, fixture);
  s.put(userSettings, '{\n  // keep my editor preferences\n  "editor.fontSize": 18,\n}\n');
  const before = await import("@earendil-works/pi-coding-agent");
  const load = async () => {
    const loader = new before.DefaultResourceLoader({
      cwd: s.project, agentDir: s.agentDir,
      settingsManager: before.SettingsManager.inMemory({ defaultProjectTrust: "always" }),
      additionalExtensionPaths: [fileURLToPath(new URL("../extensions/index.ts", import.meta.url))],
      noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
    });
    await loader.reload();
    return loader.getExtensions();
  };
  assert.ok((await load()).errors.some(error => error.error.includes('Tool "vscode_context" conflicts')),
    "fixture must reproduce the actual cross-extension conflict before setup");
  const result = s.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(globalFile), false);
  assert.equal(existsSync(projectFile), false);
  assert.equal(config(userSettings)["piContext.autoInstallCompanion"], false);
  assert.equal(config(userSettings)["editor.fontSize"], 18);
  assert.match(readFileSync(userSettings, "utf8"), /keep my editor preferences/);
  const after = await load();
  assert.deepEqual(after.errors, [], "the first load after setup has no extension conflicts");
  for (const tool of ["vscode_context", "open_in_editor"]) {
    assert.equal(after.extensions.filter(extension => extension.tools.has(tool)).length, 1);
  }
  const settingsAfterSetup = readFileSync(userSettings, "utf8");
  const repeat = s.run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(readFileSync(userSettings, "utf8"), settingsAfterSetup, "repeated setup does not rewrite settings");
});

test("setup preserves modified and unrelated extension files", (t) => {
  const s = sandbox(t);
  const customized = join(s.agentDir, "extensions", "pi-vscode-context.ts");
  const unrelated = join(s.agentDir, "extensions", "my-tools.ts");
  const modified = `${fixture}\n// user customization\n`;
  s.put(customized, modified);
  s.put(unrelated, "export default function () {}\n");
  s.put(join(s.userDir, "settings.json"), '{"editor.fontSize":18}');
  const result = s.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(customized, "utf8"), modified);
  assert.equal(readFileSync(unrelated, "utf8"), "export default function () {}\n");
});

test("invalid editor settings prevent cleanup rather than losing an installed extension", (t) => {
  const s = sandbox(t);
  const file = join(s.agentDir, "extensions", "pi-vscode-context.ts");
  const settings = join(s.userDir, "settings.json");
  s.put(file, fixture);
  s.put(settings, "{ unfinished settings");
  const result = s.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /valid JSONC object/);
  assert.equal(readFileSync(file, "utf8"), fixture);
  assert.equal(readFileSync(settings, "utf8"), "{ unfinished settings");
});

test("setup disables project overrides and keeps unrelated JSONC preferences", (t) => {
  const s = sandbox(t);
  const file = join(s.project, ".pi", "extensions", "pi-vscode-context.ts");
  const settings = join(s.project, ".vscode", "settings.json");
  s.put(file, fixture);
  s.put(settings, '{\n // project settings\n "piContext.autoInstallCompanion": true,\n "editor.tabSize": 4,\n}\n');
  const result = s.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(config(settings)["piContext.autoInstallCompanion"], false);
  assert.equal(config(settings)["editor.tabSize"], 4);
  assert.match(readFileSync(settings, "utf8"), /project settings/);
  assert.equal(existsSync(file), false);
});

test("installing without an editor creates no VS Code configuration", (t) => {
  const s = sandbox(t);
  const result = s.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(s.userDir), false);
});

test("ambiguous duplicate settings cannot silently re-enable replacement writes", (t) => {
  const s = sandbox(t);
  const file = join(s.agentDir, "extensions", "pi-vscode-context.ts");
  const settings = join(s.userDir, "settings.json");
  const ambiguous = '{"piContext.autoInstallCompanion":true,"piContext.autoInstallCompanion":true}';
  s.put(file, fixture);
  s.put(settings, ambiguous);
  const result = s.run();
  assert.equal(result.status, 1);
  assert.equal(readFileSync(file, "utf8"), fixture);
  assert.equal(readFileSync(settings, "utf8"), ambiguous);
});

test("setup preserves dangling editor-settings links and does not remove integration files", (t) => {
  const s = sandbox(t);
  const file = join(s.agentDir, "extensions", "pi-vscode-context.ts");
  const settings = join(s.userDir, "settings.json");
  s.put(file, fixture);
  mkdirSync(s.userDir, { recursive: true });
  try {
    symlinkSync(join(s.home, "missing-settings.json"), settings, process.platform === "win32" ? "junction" : "file");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") { t.skip("OS does not permit symbolic links"); return; }
    throw error;
  }
  const result = s.run();
  assert.equal(result.status, 1);
  assert.equal(lstatSync(settings).isSymbolicLink(), true);
  assert.equal(readFileSync(file, "utf8"), fixture);
});
