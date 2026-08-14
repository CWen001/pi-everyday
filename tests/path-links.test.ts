import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerOmpPathLinks } from "../src/path-links/register-omp.ts";
import { transformLocalFilePaths } from "../src/path-links/transform.ts";

const root = join(tmpdir(), `pi-everyday-paths-${process.pid}`);
mkdirSync(join(root, "output", "nested"), { recursive: true });
writeFileSync(join(root, "output", "nested", "result.txt"), "ok");

test.after(() => rmSync(root, { recursive: true, force: true }));

test("links an inline local file to its containing directory", () => {
  const result = transformLocalFilePaths("File: `output/nested/result.txt`", root);
  assert.match(result, /^File: \[`output\/nested\/result\.txt`\]\(file:\/\//);
  assert.match(result, /\/output\/nested\)$/);
});

test("links a standalone local file", () => {
  const result = transformLocalFilePaths("output/nested/result.txt", root);
  assert.match(result, /^\[output\/nested\/result\.txt\]\(file:\/\//);
});

test("rewrites an existing relative Markdown file link to its containing directory", () => {
  const result = transformLocalFilePaths("[01](output/nested/result.txt)", root);
  assert.match(result, /^\[01\]\(file:\/\//);
  assert.match(result, /\/output\/nested\)$/);
});

test("does not rewrite Markdown image targets", () => {
  const image = "![01](output/nested/result.txt)";
  assert.equal(transformLocalFilePaths(image, root), image);
});

test("supports spaces in backticked paths", () => {
  writeFileSync(join(root, "output", "with space.txt"), "ok");
  const result = transformLocalFilePaths("`output/with space.txt`", root);
  assert.match(result, /^\[`output\/with space\.txt`\]\(file:\/\//);
});

test("links an inline local directory to itself", () => {
  const result = transformLocalFilePaths("Folder: `output/nested`", root);
  assert.match(result, /^Folder: \[`output\/nested`\]\(file:\/\//);
  assert.match(result, /\/output\/nested\)$/);
});

test("OMP adapter transforms settled assistant messages", () => {
  type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
  const handlers = new Map<string, Handler>();
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;
  const ctx = { cwd: root } as ExtensionContext;
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "File: `output/nested/result.txt`" }],
  };

  registerOmpPathLinks(pi);
  handlers.get("session_start")?.({}, ctx);
  handlers.get("message_end")?.({ message }, ctx);

  assert.match(message.content[0].text, /^File: \[`output\/nested\/result\.txt`\]\(file:\/\//);
  assert.match(message.content[0].text, /\/output\/nested\)$/);
});

test("does not alter missing paths, URLs, links, or fenced code", () => {
  assert.equal(transformLocalFilePaths("`missing/file.txt`", root), "`missing/file.txt`");
  assert.equal(
    transformLocalFilePaths("`https://example.com/file.txt`", root),
    "`https://example.com/file.txt`",
  );
  const existing = "[`output/nested/result.txt`](https://example.com)";
  assert.equal(transformLocalFilePaths(existing, root), existing);
  const fenced = "```text\noutput/nested/result.txt\n```";
  assert.equal(transformLocalFilePaths(fenced, root), fenced);
});
