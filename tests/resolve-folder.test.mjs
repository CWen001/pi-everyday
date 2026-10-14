import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, parse } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePath } from "../src/path-links/resolve-folder.mjs";

const intents = ["target", "folder"];
const resolver = fileURLToPath(new URL("../src/path-links/resolve-folder.mjs", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-everyday-folder-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

for (const filename of ["结果 #1 50%.txt", "LICENSE"]) {
  test(`resolves both intents for ${filename} in a dotted Unicode directory`, (t) => {
    const folder = join(fixture(t), "研究 100%20 完成.v1");
    const file = join(folder, filename);
    mkdirSync(folder);
    writeFileSync(file, "ok");

    for (const intent of intents) {
      assert.equal(resolvePath(pathToFileURL(folder).href, intent), folder);
      assert.equal(resolvePath(pathToFileURL(file).href, intent), intent === "target" ? file : folder);
    }
  });
}

test("ignores navigation suffixes without decoding literal percent/hash twice", (t) => {
  const folder = join(fixture(t), "reports #1 %20");
  const file = join(folder, "result.txt");
  mkdirSync(folder);
  writeFileSync(file, "ok");

  for (const path of [folder, file]) {
    for (const suffix of ["?line=42", "#L42", "?line=42#L42"]) {
      for (const intent of intents) {
        assert.equal(resolvePath(`${pathToFileURL(path).href}${suffix}`, intent), intent === "target" ? path : folder);
      }
    }
  }
});

test("rejects missing paths for both intents without guessing a parent", (t) => {
  const root = fixture(t);
  for (const intent of intents) {
    assert.throws(() => resolvePath(pathToFileURL(join(root, "missing.txt")).href, intent), { code: "ENOENT" });
  }
});

test("rejects bad intents, schemes, and malformed URIs", () => {
  for (const intent of [undefined, "", "open", "TARGET", null]) {
    assert.throws(() => resolvePath("file:///unused", intent), /Expected target or folder intent/);
  }
  for (const intent of intents) {
    for (const uri of ["https://example.com/result.txt", "not a URI", "file:///bad%", "file:///bad%2Fpath"]) {
      assert.throws(() => resolvePath(uri, intent));
    }
  }
});

test("CLI returns the selected path as JSON and fails with no stdout", (t) => {
  const folder = fixture(t);
  const file = join(folder, "研究 #1 %20 ' $(echo nope).txt");
  writeFileSync(file, "ok");
  const uri = pathToFileURL(file).href;
  for (const intent of intents) {
    const result = spawnSync(process.execPath, [resolver, uri, intent], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { path: intent === "target" ? file : folder });
    assert.equal(result.stderr, "");
  }
  for (const args of [[], [uri], [uri, "bad"], [uri, "target", "extra"], ["not a URI", "folder"], [pathToFileURL(join(folder, "missing")).href, "target"]]) {
    const result = spawnSync(process.execPath, [resolver, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
  }
});

test("propagates permission errors without selecting another target", {
  skip: process.platform === "win32" || process.getuid?.() === 0,
}, (t) => {
  const folder = join(fixture(t), "private");
  mkdirSync(folder);
  const file = join(folder, "file");
  writeFileSync(file, "ok");
  chmodSync(folder, 0);
  try {
    for (const intent of intents) {
      assert.throws(() => resolvePath(pathToFileURL(file).href, intent), { code: "EACCES" });
    }
  } finally {
    chmodSync(folder, 0o700);
  }
});

test("Windows drive URIs resolve native files for both intents", { skip: process.platform !== "win32" }, (t) => {
  const folder = fixture(t);
  const file = join(folder, "drive #1 %20.txt");
  writeFileSync(file, "ok");
  const uri = pathToFileURL(file).href;
  assert.match(uri, /^file:\/\/\/[A-Za-z]:\//);
  assert.equal(resolvePath(uri, "target"), file);
  assert.equal(resolvePath(uri, "folder"), folder);
});

test("Windows decodes UNC authority and escaped path without POSIX assumptions", { skip: process.platform !== "win32" }, () => {
  assert.equal(fileURLToPath("file://server/share/%E7%A0%94%E7%A9%B6%20%2520%23.v1/LICENSE"), "\\\\server\\share\\研究 %20#.v1\\LICENSE");
});

test("Windows UNC resolver uses an accessible local administrative share", { skip: process.platform !== "win32" }, (t) => {
  const folder = fixture(t);
  const file = join(folder, "UNC #1 %20.txt");
  writeFileSync(file, "ok");
  const drive = parse(folder).root;
  const uncFolder = `\\\\${hostname().toLowerCase()}\\${drive[0]}$\\${folder.slice(drive.length)}`;
  const uncFile = join(uncFolder, "UNC #1 %20.txt");
  try {
    statSync(uncFile);
  } catch (error) {
    t.skip(`Local administrative share unavailable (${error.code}); UNC filesystem access not verified`);
    return;
  }
  assert.equal(resolvePath(pathToFileURL(uncFile).href, "target"), uncFile);
  assert.equal(resolvePath(pathToFileURL(uncFile).href, "folder"), uncFolder);
  for (const intent of intents) assert.equal(resolvePath(pathToFileURL(uncFolder).href, intent), uncFolder);
});
