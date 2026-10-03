import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { resolveFolder } from "../src/path-links/resolve-folder.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-everyday-folder-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("resolves Unicode, spaces, and percent escapes without double decoding", (t) => {
  const root = fixture(t);
  const folder = join(root, "研究 100%20 完成");
  const file = join(folder, "结果 #1 50%.txt");
  mkdirSync(folder);
  writeFileSync(file, "ok");

  assert.equal(resolveFolder(pathToFileURL(folder).href), folder);
  assert.equal(resolveFolder(pathToFileURL(file).href), folder);
});

test("uses filesystem type for extensionless files and dotted directories", (t) => {
  const root = fixture(t);
  const folder = join(root, "output.v1");
  const file = join(folder, "LICENSE");
  mkdirSync(folder);
  writeFileSync(file, "ok");

  assert.equal(resolveFolder(pathToFileURL(folder).href), folder);
  assert.equal(resolveFolder(pathToFileURL(file).href), folder);
});

test("ignores navigation query and fragment suffixes when accessing the path", (t) => {
  const root = fixture(t);
  const folder = join(root, "reports #1");
  const file = join(folder, "result.txt");
  mkdirSync(folder);
  writeFileSync(file, "ok");

  for (const path of [folder, file]) {
    for (const suffix of ["?line=42", "#L42", "?line=42#L42"]) {
      assert.equal(resolveFolder(`${pathToFileURL(path).href}${suffix}`), folder);
    }
  }
});

test("rejects missing files and directories instead of guessing a containing folder", (t) => {
  const root = fixture(t);
  assert.throws(() => resolveFolder(pathToFileURL(join(root, "missing.txt")).href), { code: "ENOENT" });
});

test("rejects non-file schemes and invalid URIs", () => {
  for (const uri of ["https://example.com/result.txt", "not a URI"]) {
    assert.throws(() => resolveFolder(uri), TypeError);
  }
});
