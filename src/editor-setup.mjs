#!/usr/bin/env node
// Run before Pi discovers extensions, never from an extension factory.
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { parse, modify, applyEdits } from "jsonc-parser";

// Exact reviewed Bridge 0.0.3 source, ignoring platform line endings only.
// Unknown revisions and personal modifications are never removed.
const REDUNDANT_SOURCE = "d05ed4c49e3d5af4dabde7ed89291b2632e4be2b97b1c50f42fabffe9f1f2e57";
const SETTING = "piContext.autoInstallCompanion";
const home = os.homedir();
const project = path.resolve(process.env.INIT_CWD || process.cwd());
const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent");
const userDir = process.platform === "win32"
  ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User")
  : process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Code", "User")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Code", "User");
const report = { configured: [], removed: [], preserved: [], errors: [] };

function fingerprint(source) {
  return createHash("sha256").update(source.replace(/\r\n/g, "\n").trimEnd()).digest("hex");
}

function configure(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const exists = !!stat;
  if (stat && !stat.isFile()) throw new Error("settings are not a regular file");
  if (stat && stat.size > 1024 * 1024) throw new Error("settings exceed the setup size limit");
  const original = exists ? fs.readFileSync(file, "utf8") : "{}\n";
  const errors = [];
  const config = parse(original, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("settings are not a valid JSONC object");
  }
  if (config[SETTING] === false) return;
  const next = applyEdits(original, modify(original, [SETTING], false, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: original.includes("\r\n") ? "\r\n" : "\n" },
  }));
  if (parse(next)[SETTING] !== false) throw new Error("ambiguous editor integration setting; resolve duplicate keys and rerun setup");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, next, { flag: "wx", mode: exists ? fs.statSync(file).mode : 0o600 });
    if (exists ? fs.readFileSync(file, "utf8") !== original : fs.existsSync(file)) {
      throw new Error("settings changed during setup; rerun setup");
    }
    fs.renameSync(temporary, file);
    report.configured.push(file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function hasBridge() {
  try {
    return fs.readdirSync(path.join(home, ".vscode", "extensions")).some(name => name.startsWith("zenyui.vscode-pi-bridge-"));
  } catch { return false; }
}

const candidates = [...new Set([
  path.join(agentDir, "extensions", "pi-vscode-context.ts"),
  path.join(project, ".pi", "extensions", "pi-vscode-context.ts"),
])];
const verified = [];
for (const file of candidates) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 64 * 1024 || fingerprint(fs.readFileSync(file, "utf8")) !== REDUNDANT_SOURCE) {
      report.preserved.push(file);
    } else {
      verified.push(file);
    }
  } catch (error) {
    if (error.code !== "ENOENT") report.errors.push(`${file}: unable to verify file`);
  }
}

// Disable replacement writes before removing anything. Failed/invalid settings
// leave the verified files in place rather than producing a half-completed setup.
if (verified.length || hasBridge() || fs.existsSync(userDir)) {
  try {
    configure(path.join(userDir, "settings.json"));
    const workspaceSettings = path.join(project, ".vscode", "settings.json");
    if (fs.existsSync(workspaceSettings)) configure(workspaceSettings);
  } catch (error) {
    report.errors.push(`Editor settings: ${error.message}`);
  }
}
if (!report.errors.length) {
  for (const file of verified) {
    try {
      if (!fs.lstatSync(file).isFile() || fingerprint(fs.readFileSync(file, "utf8")) !== REDUNDANT_SOURCE) {
        report.preserved.push(file);
        continue;
      }
      fs.unlinkSync(file);
      report.removed.push(file);
    } catch (error) {
      if (error.code !== "ENOENT") report.errors.push(`${file}: unable to remove verified file`);
    }
  }
}

const installing = process.argv.includes("--install");
if (!installing || Object.values(report).some(items => items.length)) {
  console.log(JSON.stringify(report, null, 2));
}
// Editor integration is optional: a setup failure must not break package install.
// Explicit setup fails visibly so callers can resolve permissions/settings errors.
if (report.errors.length && !installing) process.exitCode = 1;
