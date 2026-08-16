import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerOmpPathLinks } from "../src/path-links/register-omp.ts";
import { registerPathLinks } from "../src/path-links/register.ts";
import { renderPathLinks } from "../src/path-links/transform.ts";

const root = join(tmpdir(), `pi-everyday-paths-${process.pid}`);
mkdirSync(join(root, "output", "nested"), { recursive: true });
writeFileSync(join(root, "output", "nested", "result.txt"), "ok");

test.after(() => rmSync(root, { recursive: true, force: true }));

test("links an inline local file to its containing directory", () => {
  const result = renderPathLinks({ markdown: "File: `output/nested/result.txt`", cwd: root });
  assert.match(result, /^File: \[`output\/nested\/result\.txt`\]\(file:\/\//);
  assert.match(result, /\/output\/nested\)$/);
});

test("links a standalone local file", () => {
  const result = renderPathLinks({ markdown: "output/nested/result.txt", cwd: root });
  assert.match(result, /^\[output\/nested\/result\.txt\]\(file:\/\//);
});

test("rewrites an existing relative Markdown file link to its containing directory", () => {
  const result = renderPathLinks({ markdown: "[01](output/nested/result.txt)", cwd: root });
  assert.match(result, /^\[01\]\(file:\/\//);
  assert.match(result, /\/output\/nested\)$/);
});

test("does not rewrite Markdown image targets", () => {
  const image = "![01](output/nested/result.txt)";
  assert.equal(renderPathLinks({ markdown: image, cwd: root }), image);
});

test("supports spaces in backticked paths", () => {
  writeFileSync(join(root, "output", "with space.txt"), "ok");
  const result = renderPathLinks({ markdown: "`output/with space.txt`", cwd: root });
  assert.match(result, /^\[`output\/with space\.txt`\]\(file:\/\//);
});

test("links an inline local directory to itself", () => {
  const result = renderPathLinks({ markdown: "Folder: `output/nested`", cwd: root });
  assert.match(result, /^Folder: \[`output\/nested`\]\(file:\/\//);
  assert.match(result, /\/output\/nested\)$/);
});

test("Pi adapter transforms only finalized assistant Markdown", () => {
  type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
  type Transformer = (
    markdown: string,
    context: { messageType: string; isStreaming: boolean },
  ) => string;
  const handlers = new Map<string, Handler>();
  let transform: Transformer | undefined;
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    registerMarkdownTransformer(transformer: Transformer) {
      transform = transformer;
    },
  } as unknown as ExtensionAPI;

  registerPathLinks(pi);
  handlers.get("session_start")?.({}, { cwd: root } as ExtensionContext);

  assert.ok(transform);
  assert.equal(
    transform("`output/nested/result.txt`", { messageType: "assistant", isStreaming: true }),
    "`output/nested/result.txt`",
  );
  assert.equal(
    transform("`output/nested/result.txt`", { messageType: "user", isStreaming: false }),
    "`output/nested/result.txt`",
  );
  assert.match(
    transform("`output/nested/result.txt`", { messageType: "assistant", isStreaming: false }),
    /^\[`output\/nested\/result\.txt`\]\(file:\/\//,
  );
});

test("OMP adapter transforms streaming and finalized assistant display", () => {
  type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
  type Transformer = (markdown: string, context: { isStreaming: boolean }) => string;
  const handlers = new Map<string, Handler>();
  let transform: Transformer | undefined;
  const omp = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    registerAssistantTextTransformer(transformer: Transformer) {
      transform = transformer;
    },
  };

  registerOmpPathLinks(omp);
  handlers.get("session_start")?.({}, { cwd: root } as ExtensionContext);

  assert.ok(transform);
  const localMarkdownLink = "[result](output/nested/result.txt)";
  assert.match(
    transform(localMarkdownLink, { isStreaming: true }),
    /^\[result\]\(file:\/\//,
  );
  assert.match(
    transform(localMarkdownLink, { isStreaming: false }),
    /^\[result\]\(file:\/\//,
  );
});

test("OMP adapter rejects hosts without a display transformer", () => {
  assert.throws(
    () => registerOmpPathLinks({ on() {} }),
    /display-only assistant text transformers/,
  );
});

test("does not alter missing paths, URLs, links, or source-code fences", () => {
  assert.equal(renderPathLinks({ markdown: "`missing/file.txt`", cwd: root }), "`missing/file.txt`");
  assert.equal(
    renderPathLinks({ markdown: "`https://example.com/file.txt`", cwd: root }),
    "`https://example.com/file.txt`",
  );
  const existing = "[`output/nested/result.txt`](https://example.com)";
  assert.equal(renderPathLinks({ markdown: existing, cwd: root }), existing);
  const fenced = '```ts\nconst path = "output/nested/result.txt";\n```';
  assert.equal(renderPathLinks({ markdown: fenced, cwd: root }), fenced);
});

test("links a local directory in a text fence", () => {
  const result = renderPathLinks({ markdown: "```text\noutput/nested/\n```", cwd: root });

  assert.match(result, /^\[output\/nested\/\]\(file:\/\/.*\/output\/nested\)$/);
});

test("links every local path in a text path-list fence", () => {
  const result = renderPathLinks({ markdown: "```text\noutput/nested/result.txt\noutput/nested/\n```", cwd: root });

  assert.match(result, /^\[output\/nested\/result\.txt\]\(file:\/\/.*\/output\/nested\)\n/);
  assert.match(result, /\[output\/nested\/\]\(file:\/\/.*\/output\/nested\)$/);
});

test("supports long and tilde-delimited text fences", () => {
  const longFence = renderPathLinks({
    markdown: "````text\noutput/nested/result.txt\n````\nafter",
    cwd: root,
  });
  assert.match(longFence, /^\[output\/nested\/result\.txt\]\(file:\/\/.*\/output\/nested\)\nafter$/);

  const tildeFence = renderPathLinks({ markdown: "~~~text\noutput/nested/\n~~~", cwd: root });
  assert.match(tildeFence, /^\[output\/nested\/\]\(file:\/\/.*\/output\/nested\)$/);
});

test("preserves a text fence containing non-path prose", () => {
  const fenced = "```text\nArtifacts:\noutput/nested/\n```";
  assert.equal(renderPathLinks({ markdown: fenced, cwd: root }), fenced);
});

test("is idempotent after producing file links", () => {
  const once = renderPathLinks({ markdown: "`output/nested/result.txt`", cwd: root });
  assert.equal(renderPathLinks({ markdown: once, cwd: root }), once);
});

test("rejects a relative cwd at the module boundary", () => {
  assert.throws(
    () => renderPathLinks({ markdown: "output/nested/result.txt", cwd: "relative" }),
    /absolute.*cwd/,
  );
});
