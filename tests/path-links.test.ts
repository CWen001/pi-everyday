import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import { registerOmpPathLinks } from "../src/path-links/register-omp.ts";
import { registerPathLinks } from "../src/path-links/register.ts";
import { renderPathLinks } from "../src/path-links/transform.ts";

const root = join(tmpdir(), `pi-everyday-paths-${process.pid}`);
const homeRoot = join(homedir(), `.pi-everyday-paths-${process.pid}`);
const plainMarkdownTheme = Object.fromEntries(
  ["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet", "bold", "italic", "strikethrough", "underline"]
    .map((name) => [name, (text: string) => text]),
) as unknown as MarkdownTheme;
mkdirSync(join(root, "output", "nested"), { recursive: true });
mkdirSync(homeRoot, { recursive: true });
writeFileSync(join(root, "output", "nested", "result.txt"), "ok");
writeFileSync(join(homeRoot, "result.txt"), "ok");

test.after(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(homeRoot, { recursive: true, force: true });
});

test("Path Rendering links an inline local file to its containing directory", () => {
  const result = renderPathLinks({ markdown: "File: `output/nested/result.txt`", cwd: root });
  assert.match(result, /^File: \[`output\/nested\/result\.txt`\]\(file:\/\//);
  assert.match(result, /\/output\/nested\)$/);
});

test("Path Rendering links a standalone local file", () => {
  const result = renderPathLinks({ markdown: "output/nested/result.txt", cwd: root });
  assert.match(result, /^\[output\/nested\/result\.txt\]\(file:\/\//);
});

test("Path Rendering retargets an existing relative Markdown Path Link to its containing directory", () => {
  const result = renderPathLinks({ markdown: "[01](output/nested/result.txt)", cwd: root });
  assert.match(result, /^\[01\]\(file:\/\//);
  assert.match(result, /\/output\/nested\)$/);
});

test("Path Rendering leaves Markdown image targets unchanged", () => {
  const image = "![01](output/nested/result.txt)";
  assert.equal(renderPathLinks({ markdown: image, cwd: root }), image);
});

test("supports spaces in backticked paths", () => {
  writeFileSync(join(root, "output", "with space.txt"), "ok");
  const result = renderPathLinks({ markdown: "`output/with space.txt`", cwd: root });
  assert.match(result, /^\[`output\/with space\.txt`\]\(file:\/\//);
});

test("Path Rendering links an inline local directory to itself", () => {
  const result = renderPathLinks({ markdown: "Folder: `output/nested`", cwd: root });
  assert.match(result, /^Folder: \[`output\/nested`\]\(file:\/\//);
  assert.match(result, /\/output\/nested\)$/);
});

test("supports home-relative and absolute paths", () => {
  const homeRelative = `~/${homeRoot.slice(homedir().length + 1)}/result.txt`;
  assert.match(renderPathLinks({ markdown: `\`${homeRelative}\``, cwd: root }), /^\[.*\]\(file:\/\//);

  const absolute = join(root, "output", "nested", "result.txt");
  assert.match(renderPathLinks({ markdown: `\`${absolute}\``, cwd: root }), /^\[.*\]\(file:\/\//);
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
  handlers.get("session_shutdown")?.({}, {} as ExtensionContext);
});

test("Pi overlay composes once, invalidates cached modes, and releases owners independently", () => {
  type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
  const makePi = () => {
    const handlers = new Map<string, Handler>();
    const pi = {
      on(name: string, handler: Handler) {
        handlers.set(name, handler);
      },
      registerMarkdownTransformer() {},
    } as unknown as ExtensionAPI;
    return { handlers, pi };
  };

  const file = join(root, "output", "nested", "result.txt");
  const cached = new Markdown(file, 0, 0, plainMarkdownTheme);
  assert.doesNotMatch(cached.render(300).join("\n"), /file:\/\//);

  const first = makePi();
  registerPathLinks(first.pi);
  const installedRender = Markdown.prototype.render;
  const second = makePi();
  registerPathLinks(second.pi);
  assert.equal(Markdown.prototype.render, installedRender);
  assert.match(cached.render(300).join("\n"), /file:\/\//);

  const composed = new Markdown("ignored", 0, 0, plainMarkdownTheme, undefined, {
    transform: () => file,
  }).render(300).join("\n");
  assert.match(composed, /file:\/\//);
  assert.match(composed, /\/output\/nested/);

  const relative = new Markdown("output/nested/result.txt", 0, 0, plainMarkdownTheme).render(300).join("\n");
  assert.doesNotMatch(relative, /file:\/\//);

  const incompatible = new Markdown(file, 0, 0, plainMarkdownTheme);
  const internals = incompatible as unknown as { options: object };
  Object.freeze(internals.options);
  assert.doesNotMatch(incompatible.render(300).join("\n"), /file:\/\//);

  first.handlers.get("session_shutdown")?.({}, {} as ExtensionContext);
  assert.match(cached.render(300).join("\n"), /file:\/\//);

  second.handlers.get("session_shutdown")?.({}, {} as ExtensionContext);
  assert.doesNotMatch(cached.render(300).join("\n"), /file:\/\//);
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

test("preserves every fenced block, including text and unclosed fences", () => {
  const fences = [
    "```text\noutput/nested/result.txt\n```",
    "````\n`output/nested/result.txt`\n````",
    "~~~text\noutput/nested/\n~~~",
    "```text\noutput/nested/result.txt",
  ];
  for (const fenced of fences) {
    assert.equal(renderPathLinks({ markdown: fenced, cwd: root }), fenced);
  }
});

test("Path Rendering is idempotent after producing Path Links", () => {
  const once = renderPathLinks({ markdown: "`output/nested/result.txt`", cwd: root });
  assert.equal(renderPathLinks({ markdown: once, cwd: root }), once);
});

test("rejects a relative cwd at the module boundary", () => {
  assert.throws(
    () => renderPathLinks({ markdown: "output/nested/result.txt", cwd: "relative" }),
    /absolute.*cwd/,
  );
});
