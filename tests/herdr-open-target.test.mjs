import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openTarget } from "../src/path-links/herdr/open-target.mjs";

const entry = fileURLToPath(new URL("../src/path-links/herdr/open-target.mjs", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-everyday-herdr-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, "研究 #1 %20.v1");
  mkdirSync(folder);
  const file = join(folder, "result %2F $(echo nope) '&.txt");
  writeFileSync(file, "ok");
  return { root, folder, file };
}

function launcher() {
  const calls = [];
  let unrefs = 0;
  const launch = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.unref = () => unrefs++;
    process.nextTick(() => child.emit("spawn"));
    return child;
  };
  return { calls, launch, unrefs: () => unrefs };
}

for (const platform of ["win32", "darwin"]) {
  test(`${platform} launch uses one native target argument and reports acceptance only`, {
    skip: platform === "win32" && process.platform !== "win32",
  }, async (t) => {
    const { file, folder } = fixture(t);
    const recorder = launcher();
    for (const path of [file, folder]) {
      for (const suffix of ["", "?line=2#L2"]) {
        const result = await openTarget(`${pathToFileURL(path).href}${suffix}`, {
          platform,
          launch: recorder.launch,
          env: { SystemRoot: "C:\\Windows" },
        });
        assert.deepEqual(result, { path, accepted: true });
        assert.deepEqual(recorder.calls.at(-1), [
          platform === "win32" ? win32.join("C:\\Windows", "explorer.exe") : "/usr/bin/open",
          [path],
          { shell: false, windowsHide: false, detached: true, stdio: "ignore" },
        ]);
      }
    }
    assert.equal(recorder.unrefs(), 4);
  });
}

test("adapter rejects malformed, nonlocal, control, and encoded-separator URIs before launch", async () => {
  const recorder = launcher();
  const invalid = [
    undefined, null, 42, "", "not a URI", "https://example.com/a", "file:relative", "file:/tmp/a",
    " file:///tmp/a", "file:///tmp/raw space", "file:///tmp/a\n", "file:///tmp/\u0085",
    "file://remote/share/a", "file://127.0.0.1/share/a", "file://user:password@localhost/a",
    "file:///bad%", "file:///bad%GG", "file:///tmp/a%2Fb", "file:///tmp/a%5Cb",
    "file:///tmp/%00", "file:///tmp/%09", "file:///tmp/%7f", "file:///tmp/%C2%85",
    "file:///tmp/%FF", "file:///C:\\tmp\\file.txt",
  ];
  for (const platform of ["win32", "darwin"]) {
    for (const uri of invalid) {
      await assert.rejects(openTarget(uri, { platform, launch: recorder.launch }));
    }
  }
  assert.equal(recorder.calls.length, 0);
});

test("Windows adapter rejects native-incompatible names without tightening the shared resolver", async () => {
  const recorder = launcher();
  for (const uri of [
    "file:///tmp/no-drive", "file:///C:/dir/file%3Astream", "file:///C:/dir/file.", "file:///C:/dir/file%20",
    "file:///C:/dir/a%3Fb", "file:///C:/dir/a%2Ab", "file:///C:/dir/a%22b", "file:///C:/dir/a%3Cb",
    "file:///C:/dir/a%3Eb", "file:///C:/dir/a%7Cb", "file:///C:/CON", "file:///C:/nul.txt",
    "file:///C:/COM1/file", "file:///C:/lpt%C2%B2.txt", "file:///C:/CONOUT$",
  ]) {
    await assert.rejects(openTarget(uri, { platform: "win32", launch: recorder.launch }));
  }
  assert.equal(recorder.calls.length, 0);
});

test("missing targets, unsupported platforms, and missing SystemRoot do not launch", async (t) => {
  const { root, file } = fixture(t);
  const recorder = launcher();
  const platform = process.platform === "win32" ? "win32" : "darwin";
  await assert.rejects(openTarget(pathToFileURL(join(root, "missing")).href, { platform, launch: recorder.launch }), { code: "ENOENT" });
  await assert.rejects(openTarget(pathToFileURL(file).href, { platform: "linux", launch: recorder.launch }), /Unsupported platform/);
  if (process.platform === "win32") {
    for (const env of [{}, { SystemRoot: "relative" }]) {
      await assert.rejects(openTarget(pathToFileURL(file).href, { env, launch: recorder.launch }), /SystemRoot/);
    }
  }
  assert.equal(recorder.calls.length, 0);
});

test("localhost file URIs retain target identity", async (t) => {
  const { file } = fixture(t);
  const recorder = launcher();
  const uri = pathToFileURL(file).href.replace("file:///", "file://localhost/");
  const platform = process.platform === "win32" ? "win32" : "darwin";
  assert.deepEqual(await openTarget(uri, { platform, launch: recorder.launch }), { path: file, accepted: true });
});

test("synchronous and asynchronous launch errors propagate without acceptance", async (t) => {
  const { root, file } = fixture(t);
  const uri = pathToFileURL(file).href;
  const platform = process.platform === "win32" ? "win32" : "darwin";
  const error = new Error("launch refused");
  await assert.rejects(openTarget(uri, { platform, launch: () => { throw error; } }), (actual) => actual === error);
  await assert.rejects(openTarget(uri, {
    platform,
    launch: (_command, args, options) => spawn(join(root, "missing-executable"), args, options),
  }), { code: "ENOENT" });
});

test("native plugin command and CLI use clicked target only, never a folder intent", {
  skip: process.platform !== "win32" && process.platform !== "darwin",
}, (t) => {
  const { root, file, folder } = fixture(t);
  const preload = join(root, "launch-stub.mjs");
  const receipt = join(root, "launch.json");
  writeFileSync(preload, `
import cp from "node:child_process";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
cp.spawn = (...args) => {
  writeFileSync(process.env.TEST_RECEIPT, JSON.stringify(args));
  const child = new EventEmitter();
  child.unref = () => {};
  process.nextTick(() => process.env.TEST_LAUNCH_ERROR
    ? child.emit("error", new Error("native launch refused")) : child.emit("spawn"));
  return child;
};
syncBuiltinESMExports();
`);
  const manifest = readFileSync(join(dirname(entry), "herdr-plugin.toml"), "utf8");
  const command = JSON.parse(manifest.match(/^command = (.+)$/m)[1]);
  assert.deepEqual(command, ["node", "open-target.mjs"]);
  assert.equal((manifest.match(/\[\[link_handlers\]\]/g) ?? []).length, 1);
  assert.match(manifest, /pattern = "\(\?i\)\^file:"/);
  const uri = pathToFileURL(file).href;
  const env = { ...process.env, HERDR_PLUGIN_CLICKED_URL: uri, TEST_RECEIPT: receipt };
  const run = (args, overrides = {}) => spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, command[1], ...args], {
    cwd: dirname(entry), env: { ...env, ...overrides }, encoding: "utf8",
  });
  for (const [args, expected] of [[[], file], [[`${uri}?line=2#L2`], file], [[pathToFileURL(folder).href], folder]]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { path: expected, accepted: true });
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(readFileSync(receipt, "utf8"))[1], [expected]);
  }
  for (const [args, overrides] of [
    [[uri, "folder"], {}],
    [["file:///bad%"], {}],
    [[], { HERDR_PLUGIN_CLICKED_URL: "" }],
    [[uri], { TEST_LAUNCH_ERROR: "1" }],
  ]) {
    const result = run(args, overrides);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
  }
});
