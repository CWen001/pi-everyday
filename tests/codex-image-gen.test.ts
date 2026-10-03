import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
const runner = resolve("skills/codex-image-gen/scripts/run.mjs");
const fake = resolve("tests/fixtures/fake-codex.mjs");

async function fixture(t: TestContext, scenario = "success") {
  const root = await mkdtemp(join(tmpdir(), "codex-image-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "codex"), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
  await chmod(join(bin, "codex"), 0o755);
  await writeFile(join(bin, "codex.cmd"), `@"${process.execPath}" "${fake}" %*\r\n`);
  const capture = join(root, "capture.jsonl");
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CODEX_HOME: join(root, "codex-home"), FAKE_CODEX_CAPTURE: capture, FAKE_CODEX_SCENARIO: scenario };
  return { root, env, capture, async run(args: string[] = [], prompt = "  a red kite  \n", overrides = {}) {
    const child = spawn(process.execPath, [runner, ...args], { cwd: root, env: { ...env, ...overrides } });
    child.stdin.end(prompt);
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    const code = await new Promise<number | null>((resolveCode, reject) => {
      child.on("error", reject); child.on("close", resolveCode);
    });
    return { code, stdout, stderr, output: stdout.trim() ? JSON.parse(stdout) : null };
  }, async calls() { return (await readFile(capture, "utf8")).trim().split("\n").map((line) => JSON.parse(line)); } };
}

test("a valid image is delivered with an unknown-evidence warning and its original intact", async (t) => {
  const f = await fixture(t, "unknown-schema");
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.output.images.length, 1);
  assert.equal(result.output.runs[0].check.status, "incomplete");
  const [call] = await f.calls();
  assert.deepEqual(await readFile(result.output.path), await readFile(call.artifact));
  assert.ok(call.prompt.startsWith("  a red kite  \n"));
  assert.equal(result.output.mode, "built-in image_gen");
  assert.equal(result.output.referenceImage, false);
  assert.ok(result.output.diagnostic);
});

for (const scenario of ["success", "duplicate", "inline", "legitimate-tools", "opaque-wrapper", "nonzero", "evolved-features"]) {
  test(`single-run delivery: ${scenario}`, async (t) => {
    const f = await fixture(t, scenario);
    const result = await f.run();
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.output.images.length, 1);
    assert.equal((await f.calls()).length, 1);
    assert.equal((await readFile(result.output.path)).subarray(1, 4).toString(), "PNG");
    assert.equal(result.stdout.includes("iVBOR"), false);
    assert.equal((await readFile(result.output.diagnostic, "utf8")).includes("iVBOR"), false);
    if (scenario === "nonzero") assert.match(result.output.runs[0].error, /exited 7/);
  });
}

test("ordered multiple references and creative text survive paths containing spaces", async (t) => {
  const f = await fixture(t);
  const images = [join(f.root, "first reference.png"), join(f.root, "second reference.png")];
  for (const path of images) await writeFile(path, "reference fixture");
  const output = join(f.root, "image output.png");
  const result = await f.run([...images.flatMap((path) => ["--image", path]), "--output", output]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.output.path, output);
  assert.deepEqual(result.output.referenceImages, images);
  const [call] = await f.calls();
  const attached = call.args.flatMap((arg: string, index: number) => arg === "--image" ? [call.args[index + 1]] : []);
  assert.deepEqual(attached, images);
  assert.ok(call.prompt.startsWith("  a red kite  \n"));
});

for (const scenario of ["wrong-session", "outside-path", "invalid-image", "missing-rollout"]) {
  test(`invalid provenance or artifact stops safely: ${scenario}`, async (t) => {
    const f = await fixture(t, scenario);
    const result = await f.run();
    assert.equal(result.code, 1);
    assert.equal(result.output.images.length, 0);
    assert.equal((await f.calls()).length, 1);
    assert.ok(result.output.errors.length);
  });
}

test("a true violation still delivers valid artifacts and reports failure", async (t) => {
  const f = await fixture(t, "other-tool");
  const result = await f.run();
  assert.equal(result.code, 1);
  assert.equal(result.output.status, "partial");
  assert.equal(result.output.images.length, 1);
  assert.equal(result.output.runs[0].check.status, "violation");
  assert.equal((await f.calls()).length, 1);
});

test("output collision after generation preserves both existing output and source without regenerating", async (t) => {
  const f = await fixture(t, "output-race");
  const output = join(f.root, "collision.png");
  const result = await f.run(["--output", output], "kite", { FAKE_OUTPUT: output });
  assert.equal(result.code, 1);
  assert.equal(await readFile(output, "utf8"), "keep existing");
  const [call] = await f.calls();
  assert.ok((await readFile(call.artifact)).length > 0);
  assert.equal((await f.calls()).length, 1);
  assert.equal(result.output.images[0].delivery, "original-only");
  assert.equal(await realpath(result.output.images[0].path), await realpath(call.artifact));
});

test("a temporary generation failure retries once and delivers the second result", async (t) => {
  const f = await fixture(t, "retry");
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await f.calls()).length, 2);
  assert.equal(result.output.submissions, 2);
  assert.equal(result.output.images[0].attempt, 2);
});

for (const [scenario, calls, submissions, code] of [
  ["always-fail", 3, 3, 1], ["inner-retry", 2, 3, 0], ["login", 1, 1, 1],
  ["refusal", 1, 1, 1], ["rate-limit", 1, 1, 1], ["rate-reset", 2, 2, 0],
  ["inner-budget", 1, 3, 1], ["over-budget", 1, 4, 1],
] as const) {
  test(`bounded retries and stopping: ${scenario}`, async (t) => {
    const f = await fixture(t, scenario);
    const result = await f.run();
    assert.equal(result.code, code, result.stderr);
    assert.equal((await f.calls()).length, calls);
    assert.equal(result.output.submissions, submissions);
  });
}

test("a pending task resumes the same thread without a new generation", async (t) => {
  const f = await fixture(t, "pending");
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  const calls = await f.calls();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].resume, true);
  assert.equal(calls[1].threadId, calls[0].threadId);
  assert.equal(result.output.submissions, 1);
  assert.equal(result.output.runs.length, 1);
});

test("late recovered images and retry results are both delivered in attempt order", async (t) => {
  const f = await fixture(t, "late-result");
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.output.images.map((image: { attempt: number }) => image.attempt), [1, 2]);
  assert.equal(result.output.images[0].recovered, true);
  assert.equal((await f.calls()).length, 2);
});

test("a timed-out process is stopped, but its completed image is recovered without regeneration", async (t) => {
  const f = await fixture(t, "hang");
  const preload = join(f.root, "short-timeouts.mjs");
  await writeFile(preload, "const real=globalThis.setTimeout; globalThis.setTimeout=(fn,ms,...args)=>real(fn,ms>100000?700:ms,...args);\n");
  const result = await f.run([], "kite", { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` });
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await f.calls()).length, 1);
  assert.equal(result.output.images[0].recovered, true);
  assert.match(result.output.runs[0].error, /timed out/);
});

test("partial delivery exposes the remaining recoverable source without hiding successful images", async (t) => {
  const f = await fixture(t, "partial");
  const result = await f.run();
  assert.equal(result.code, 1);
  assert.equal(result.output.images.length, 1);
  assert.equal(result.output.runs[0].artifacts.length, 2);
  assert.equal((await f.calls()).length, 1);
  assert.ok((await readFile(result.output.images[0].path)).length > 0);
});

test("truncated nonessential records do not suppress an already completed image", async (t) => {
  const f = await fixture(t, "malformed");
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.output.runs[0].check.status, "incomplete");
  assert.equal(result.output.images.length, 1);
});

test("the request deadline stops further attempts", async (t) => {
  const f = await fixture(t, "always-fail");
  const preload = join(f.root, "deadline.mjs");
  await writeFile(preload, "import{existsSync,statSync}from'node:fs';const real=Date.now;const path=process.env.FAKE_CODEX_CAPTURE;Date.now=()=>real()+(existsSync(path)&&real()-statSync(path).mtimeMs>800?31*60000:0);\n");
  const result = await f.run([], "kite", { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` });
  assert.equal(result.code, 1);
  assert.equal((await f.calls()).length, 1);
});

test("invalid input is rejected before Codex runs", async (t) => {
  const f = await fixture(t);
  for (const [args, prompt] of [[[], " "], [["--image", join(f.root, "missing.png")], "kite"], [["--output"], "kite"]] as Array<[string[], string]>) {
    assert.equal((await f.run(args, prompt)).code, 1);
  }
  const output = join(f.root, "existing.png");
  await writeFile(output, "keep");
  assert.equal((await f.run(["--output", output])).code, 1);
  assert.equal(await readFile(output, "utf8"), "keep");
  await assert.rejects(readFile(f.capture), /ENOENT/);
});
