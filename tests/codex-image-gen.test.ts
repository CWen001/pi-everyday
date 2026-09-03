import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

const runner = join(
  process.cwd(),
  "skills",
  "codex-image-gen",
  "scripts",
  "run.mjs",
);

async function makeFakeCodex(root: string): Promise<string> {
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  const fake = join(bin, "fake-codex.mjs");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "features" && args[1] === "list") {
  let names = ["multi_agent", "shell_tool", "unified_exec", "apps", "plugins", "browser_use", "computer_use", "skill_search", "hooks", "tool_suggest", "image_generation"];
  if (process.env.FAKE_CODEX_SCENARIO === "missing-feature") names = names.filter(name => name !== "image_generation");
  console.log(names.map(name => name + (process.env.FAKE_CODEX_SCENARIO === "removed-feature" && name === "image_generation" ? " removed false" : " stable true")).join("\\n"));
  process.exit(0);
}
if (args[0] === "exec" && args.includes("--help")) {
  console.log("--ignore-user-config --disable --enable --sandbox --skip-git-repo-check --json --image --cd");
  process.exit(0);
}
if (args[0] !== "exec") process.exit(2);
const prompt = readFileSync(0, "utf8");
const threadId = "019ec414-6cbd-7a21-96f6-25bd9c495df3";
const artifact = process.env.FAKE_CODEX_SCENARIO === "outside-path"
  ? join(process.env.CODEX_HOME, "..", "important.png")
  : join(process.env.CODEX_HOME, "generated_images", threadId, "ig_test.png");
writeFileSync(process.env.FAKE_CODEX_CAPTURE, JSON.stringify({ args, prompt, artifact }));
if (process.env.FAKE_CODEX_SCENARIO === "nonzero") {
  console.error("simulated Codex failure");
  process.exit(7);
}
mkdirSync(dirname(artifact), { recursive: true });
if (process.env.FAKE_CODEX_SCENARIO === "symlink-artifact") {
  const target = artifact + ".target";
  writeFileSync(target, "generated-image");
  symlinkSync(target, artifact);
} else if (process.env.FAKE_CODEX_SCENARIO !== "missing-artifact") {
  writeFileSync(artifact, "generated-image");
}
const rollout = join(process.env.CODEX_HOME, "sessions", "2026", "08", "14", "rollout-2026-08-14T12-00-00-" + threadId + ".jsonl");
mkdirSync(dirname(rollout), { recursive: true });
const events = [
  { type: "session_meta", payload: { id: threadId, session_id: threadId } },
  { type: "world_state", payload: { full: true, state: {} } },
  { type: "event_msg", payload: { type: "image_generation_end", call_id: "ig_test", status: "completed", saved_path: artifact } }
];
const customScenarios = ["custom-call", "computed-tool-call", "current-custom-call", "current-null-paths", "current-trailing-comma", "current-last-images", "item-completed", "missing-custom-call-id"];
if (!customScenarios.includes(process.env.FAKE_CODEX_SCENARIO)) {
  events.splice(1, 0, { type: "response_item", payload: { type: "image_generation_call", id: "ig_test", status: "generating" } });
}
if (customScenarios.includes(process.env.FAKE_CODEX_SCENARIO)) {
  const input = process.env.FAKE_CODEX_SCENARIO === "computed-tool-call"
    ? '// @exec: {"yield_time_ms": 120000}\\nconst result = await tools.image_gen__imagegen({prompt:tools["other_tool"]()});\\ngeneratedImage(result);'
    : ["current-custom-call", "current-null-paths", "current-trailing-comma", "current-last-images"].includes(process.env.FAKE_CODEX_SCENARIO)
      ? '// @exec: {"yield_time_ms": 120000, "max_output_tokens": 1000}\\nconst result = await tools.image_gen__imagegen({prompt: ' + String.fromCharCode(96) + 'draw one kite\\n\\nNo text.' + String.fromCharCode(96) + (process.env.FAKE_CODEX_SCENARIO === "current-trailing-comma" ? ',' : ', ' + (process.env.FAKE_CODEX_SCENARIO === "current-last-images" ? 'num_last_images_to_include: 0' : 'referenced_image_paths: ' + (process.env.FAKE_CODEX_SCENARIO === "current-null-paths" ? 'null' : '[]'))) + '});\\ngeneratedImage(result);'
      : '// @exec: {"yield_time_ms": 120000}\\nconst result = await tools.image_gen__imagegen({"prompt":"kite"});\\ngeneratedImage(result);';
  events.splice(2, 0,
    { type: "response_item", payload: { type: "custom_tool_call", name: "exec", status: "completed", call_id: "outer_test", input } },
    { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "outer_test", output: "generated" } },
  );
  if (process.env.FAKE_CODEX_SCENARIO === "missing-custom-call-id") {
    delete events[2].payload.call_id;
    delete events[3].payload.call_id;
  }
}
if (["current-custom-call", "current-null-paths", "current-trailing-comma", "current-last-images", "item-completed"].includes(process.env.FAKE_CODEX_SCENARIO)) {
  events[events.length - 1] = {
    type: "event_msg",
    payload: {
      type: "item_completed",
      thread_id: threadId,
      turn_id: "turn-1",
      item: {
        type: "Extension",
        kind: "image_gen.generation",
        id: "exec-1",
        status: "completed",
        savedPath: artifact,
        failure: null,
      },
    },
  };
}
if (process.env.FAKE_CODEX_SCENARIO === "zero-calls") events.pop();
if (process.env.FAKE_CODEX_SCENARIO === "multiple-calls") {
  events.push({ type: "event_msg", payload: { type: "image_generation_end", call_id: "ig_second", status: "completed", saved_path: artifact } });
}
if (process.env.FAKE_CODEX_SCENARIO === "wrong-session") {
  events[0].payload.id = "another-thread";
  events[0].payload.session_id = "another-thread";
}
if (process.env.FAKE_CODEX_SCENARIO === "missing-saved-path") delete events.at(-1).payload.saved_path;
if (process.env.FAKE_CODEX_SCENARIO === "failed-generation") {
  events.at(-1).payload.status = "failed";
}
if (process.env.FAKE_CODEX_SCENARIO === "missing-call-id") {
  delete events.at(-1).payload.call_id;
}
if (process.env.FAKE_CODEX_SCENARIO === "other-tool") {
  events.splice(1, 0, { type: "response_item", payload: { type: "function_call", name: "exec_command" } });
}
if (process.env.FAKE_CODEX_SCENARIO === "unknown-schema") {
  events.splice(1, 0, { type: "response_item", payload: { type: "future_tool_event" } });
}
const rolloutBody = events.map(JSON.stringify).join("\\n") + "\\n";
if (process.env.FAKE_CODEX_SCENARIO !== "missing-rollout") writeFileSync(rollout, rolloutBody);
if (process.env.FAKE_CODEX_SCENARIO === "unlink-failure" && process.platform !== "win32") {
  chmodSync(dirname(artifact), 0o555);
}
if (process.env.FAKE_CODEX_SCENARIO === "unreadable-artifact" && process.platform !== "win32") {
  chmodSync(artifact, 0o000);
}
if (process.env.FAKE_CODEX_SCENARIO === "duplicate-rollout") {
  const duplicate = join(process.env.CODEX_HOME, "sessions", "2026", "08", "15", "rollout-2026-08-15T12-00-00-" + threadId + ".jsonl");
  mkdirSync(dirname(duplicate), { recursive: true });
  writeFileSync(duplicate, rolloutBody);
}
console.log(JSON.stringify({ type: "thread.started", thread_id: threadId }));
if (process.env.FAKE_CODEX_SCENARIO === "hang") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1_000);
} else console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
`,
  );
  await chmod(fake, 0o755);
  await writeFile(join(bin, "codex"), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
  await chmod(join(bin, "codex"), 0o755);
  await writeFile(join(bin, "codex.cmd"), `@"${process.execPath}" "${fake}" %*\r\n`);
  return bin;
}

async function run(
  cwd: string,
  args: string[],
  prompt: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [runner, ...args], { cwd, env });
  child.stdin.end(prompt);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) =>
    child.on("close", resolve),
  );
  return { code, stdout, stderr };
}

test("a prompt produces one audited workspace image", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-"));
  const workspace = join(root, "workspace");
  const codexHome = join(root, "codex-home");
  const capture = join(root, "capture.json");
  await mkdir(workspace);
  const bin = await makeFakeCodex(root);

  const result = await run(workspace, [], "  a red paper kite  \n", {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CODEX_HOME: codexHome,
    FAKE_CODEX_CAPTURE: capture,
    FAKE_CODEX_SCENARIO: "legacy-call",
  });

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, "built-in image_gen");
  assert.equal(output.referenceImage, false);
  assert.match(output.path, /\.scratch[/\\]generated-images[/\\].+\.png$/);
  assert.equal(await readFile(output.path, "utf8"), "generated-image");

  const invocation = JSON.parse(await readFile(capture, "utf8"));
  assert.ok(invocation.prompt.startsWith("  a red paper kite  \n"));
  assert.match(invocation.prompt, /exactly once/i);
  assert.match(invocation.prompt, /first and only tool call/i);
  assert.match(invocation.prompt, /apply_patch/i);
  assert.ok(invocation.args.includes("--ignore-user-config"));
  assert.ok(invocation.args.includes("--skip-git-repo-check"));
  assert.ok(invocation.args.includes("--json"));
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf("--sandbox"), invocation.args.indexOf("--sandbox") + 2),
    ["--sandbox", "read-only"],
  );
  for (const feature of [
    "multi_agent",
    "shell_tool",
    "unified_exec",
    "apps",
    "plugins",
    "browser_use",
    "computer_use",
    "skill_search",
    "hooks",
    "tool_suggest",
  ]) {
    assert.ok(
      invocation.args.some(
        (value: string, index: number) =>
          value === "--disable" && invocation.args[index + 1] === feature,
      ),
      feature,
    );
  }
  assert.ok(
    invocation.args.some(
      (value: string, index: number) =>
        value === "--enable" && invocation.args[index + 1] === "image_generation",
    ),
  );
  const isolatedCwd = invocation.args[invocation.args.indexOf("--cd") + 1];
  assert.match(isolatedCwd, /codex-image-gen-/);
  assert.notEqual(isolatedCwd, workspace);
  assert.equal(invocation.args.includes("--image"), false);
});

test("current Codex JavaScript image calls produce audited workspace images", async () => {
  for (const scenario of ["current-custom-call", "current-null-paths", "current-trailing-comma"]) {
    const root = await mkdtemp(join(tmpdir(), `codex-image-gen-${scenario}-`));
    const workspace = join(root, "workspace");
    const codexHome = join(root, "codex-home");
    await mkdir(workspace);
    const bin = await makeFakeCodex(root);

    const result = await run(workspace, [], "a red paper kite", {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: codexHome,
      FAKE_CODEX_CAPTURE: join(root, "capture.json"),
      FAKE_CODEX_SCENARIO: scenario,
    });

    assert.equal(result.code, 0, `${scenario}: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "built-in image_gen");
    assert.equal(await readFile(output.path, "utf8"), "generated-image");
  }
});

test("Codex item_completed provenance produces one audited workspace image", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-item-completed-"));
  const workspace = join(root, "workspace");
  const codexHome = join(root, "codex-home");
  await mkdir(workspace);
  const bin = await makeFakeCodex(root);

  const result = await run(workspace, [], "a red paper kite", {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CODEX_HOME: codexHome,
    FAKE_CODEX_CAPTURE: join(root, "capture.json"),
    FAKE_CODEX_SCENARIO: "item-completed",
  });

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, "built-in image_gen");
  assert.equal(await readFile(output.path, "utf8"), "generated-image");
});

test("one reference image reaches Codex and an explicit destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-reference-"));
  const workspace = join(root, "workspace");
  const codexHome = join(root, "codex-home");
  const capture = join(root, "capture.json");
  const reference = join(root, "reference.png");
  const output = join(workspace, "art", "kite.png");
  await mkdir(workspace);
  await writeFile(reference, "reference-image");
  const bin = await makeFakeCodex(root);

  const result = await run(
    workspace,
    ["--image", reference, "--output", output],
    "edit the kite to blue",
    {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: codexHome,
      FAKE_CODEX_CAPTURE: capture,
      FAKE_CODEX_SCENARIO: "custom-call",
    },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    path: output,
    referenceImage: true,
    mode: "built-in image_gen",
  });
  assert.equal(await readFile(output, "utf8"), "generated-image");
  const invocation = JSON.parse(await readFile(capture, "utf8"));
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf("--image")),
    ["--image", reference],
  );
});

test("invalid input fails before Codex runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-input-"));
  const workspace = join(root, "workspace");
  const missingImage = join(root, "missing.png");
  const existingOutput = join(root, "existing.png");
  const unreadableImage = join(root, "unreadable.png");
  await mkdir(workspace);
  await writeFile(existingOutput, "keep-me");
  await writeFile(unreadableImage, "reference");

  const empty = await run(workspace, [], "   ", process.env);
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /must not be empty/);

  const blockedLogWorkspace = join(root, "blocked-log-workspace");
  await mkdir(blockedLogWorkspace);
  await writeFile(join(blockedLogWorkspace, ".scratch"), "not-a-directory");
  const fallbackLog = await run(blockedLogWorkspace, [], "   ", process.env);
  assert.equal(fallbackLog.code, 1);
  assert.match(fallbackLog.stderr, /must not be empty/);
  assert.match(fallbackLog.stderr, /log: [^;\n]+\.jsonl/);

  const missing = await run(workspace, ["--image", missingImage], "kite", process.env);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /ENOENT/);

  const overwrite = await run(workspace, ["--output", existingOutput], "kite", process.env);
  assert.equal(overwrite.code, 1);
  assert.match(overwrite.stderr, /already exists/);
  assert.equal(await readFile(existingOutput, "utf8"), "keep-me");

  const bin = await makeFakeCodex(root);
  const duplicate = await run(
    workspace,
    ["--output", join(root, "first.png"), "--output", join(root, "second.png")],
    "kite",
    {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: join(root, "duplicate-codex-home"),
      FAKE_CODEX_CAPTURE: join(root, "duplicate-capture.json"),
    },
  );
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr, /duplicate option --output/);

  if (process.platform !== "win32") {
    await chmod(unreadableImage, 0o000);
    const unreadable = await run(
      workspace,
      ["--image", unreadableImage],
      "kite",
      {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        CODEX_HOME: join(root, "codex-home"),
        FAKE_CODEX_CAPTURE: join(root, "unreadable-capture.json"),
      },
    );
    await chmod(unreadableImage, 0o600);
    assert.equal(unreadable.code, 1);
    assert.match(unreadable.stderr, /EACCES|permission denied/i);
  }
});

test("unavailable isolation features fail before the agent run", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-feature-"));
  const workspace = join(root, "workspace");
  const capture = join(root, "capture.json");
  await mkdir(workspace);
  const bin = await makeFakeCodex(root);

  for (const scenario of ["missing-feature", "removed-feature"]) {
    const result = await run(workspace, [], "a red paper kite", {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: join(root, `${scenario}-codex-home`),
      FAKE_CODEX_CAPTURE: capture,
      FAKE_CODEX_SCENARIO: scenario,
    });

    assert.equal(result.code, 1, scenario);
    assert.match(result.stderr, /required feature image_generation/, scenario);
    await assert.rejects(readFile(capture), /ENOENT/);
  }
});

test("documented Codex and rollout failures fail closed", async () => {
  const cases: Array<[string, RegExp]> = [
    ["nonzero", /codex exited 7/],
    ["missing-rollout", /matching rollout, found 0/],
    ["zero-calls", /one image_gen end event, found 0/],
    ["multiple-calls", /one image_gen end event, found 2/],
    ["wrong-session", /session metadata/],
    ["failed-generation", /image_gen generation failed/],
    ["missing-call-id", /valid call id/],
    ["missing-custom-call-id", /unsupported custom tool call/],
    ["missing-saved-path", /did not record one saved artifact/],
    ["missing-artifact", /ENOENT/],
  ];
  if (process.platform !== "win32") {
    cases.push(
      ["symlink-artifact", /regular file/],
      ["unreadable-artifact", /EACCES|permission denied/i],
    );
  }

  for (const [scenario, message] of cases) {
    const root = await mkdtemp(join(tmpdir(), `codex-image-gen-${scenario}-`));
    const workspace = join(root, "workspace");
    const capture = join(root, "capture.json");
    await mkdir(workspace);
    const bin = await makeFakeCodex(root);
    const result = await run(workspace, [], "a red paper kite", {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: join(root, "codex-home"),
      FAKE_CODEX_CAPTURE: capture,
      FAKE_CODEX_SCENARIO: scenario,
    });
    assert.equal(result.code, 1, scenario);
    assert.match(result.stderr, message, scenario);
    assert.match(result.stderr, /log: [^;\n]+\.jsonl/, scenario);
    if (scenario === "unreadable-artifact") {
      const invocation = JSON.parse(await readFile(capture, "utf8"));
      await chmod(invocation.artifact, 0o600);
      assert.equal(await readFile(invocation.artifact, "utf8"), "generated-image");
    }
  }
});

test("a timed-out Codex run is stopped and logged without moving its artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-timeout-"));
  const workspace = join(root, "workspace");
  const codexHome = join(root, "codex-home");
  const capture = join(root, "capture.json");
  const preload = join(root, "short-timeouts.mjs");
  await mkdir(workspace);
  await writeFile(
    preload,
    "const real = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...args) => real(fn, ms > 100_000 || ms === 2_000 ? 50 : ms, ...args);\n",
  );
  const bin = await makeFakeCodex(root);

  const result = await run(workspace, [], "a red paper kite", {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CODEX_HOME: codexHome,
    FAKE_CODEX_CAPTURE: capture,
    FAKE_CODEX_SCENARIO: "hang",
    NODE_OPTIONS: `--import=${preload}`,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /timed out/i);
  assert.match(result.stderr, /log: [^;\n]+\.jsonl/);
  assert.match(result.stderr, /rollout: [^;\n]+\.jsonl/);
  const invocation = JSON.parse(await readFile(capture, "utf8"));
  assert.equal(await readFile(invocation.artifact, "utf8"), "generated-image");
});

test("ambiguous rollout provenance fails without moving the artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-rollout-"));
  const workspace = join(root, "workspace");
  const codexHome = join(root, "codex-home");
  const capture = join(root, "capture.json");
  await mkdir(workspace);
  const bin = await makeFakeCodex(root);

  const result = await run(workspace, [], "a red paper kite", {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CODEX_HOME: codexHome,
    FAKE_CODEX_CAPTURE: capture,
    FAKE_CODEX_SCENARIO: "duplicate-rollout",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /matching rollout, found 2/);
  const invocation = JSON.parse(await readFile(capture, "utf8"));
  assert.equal(await readFile(invocation.artifact, "utf8"), "generated-image");
});

test("a saved path outside Codex generated_images fails without moving it", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-path-failure-"));
  const workspace = join(root, "workspace");
  const codexHome = join(root, "codex-home");
  const capture = join(root, "capture.json");
  const output = join(workspace, "result.png");
  await mkdir(workspace);
  const bin = await makeFakeCodex(root);

  const result = await run(workspace, ["--output", output], "a red paper kite", {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CODEX_HOME: codexHome,
    FAKE_CODEX_CAPTURE: capture,
    FAKE_CODEX_SCENARIO: "outside-path",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /generated_images/i);
  const invocation = JSON.parse(await readFile(capture, "utf8"));
  assert.equal(await readFile(invocation.artifact, "utf8"), "generated-image");
  await assert.rejects(readFile(output), /ENOENT/);
});

test("an unknown rollout schema fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-schema-"));
  const workspace = join(root, "workspace");
  const capture = join(root, "capture.json");
  await mkdir(workspace);
  const bin = await makeFakeCodex(root);

  const result = await run(workspace, [], "a red paper kite", {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CODEX_HOME: join(root, "codex-home"),
    FAKE_CODEX_CAPTURE: capture,
    FAKE_CODEX_SCENARIO: "unknown-schema",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /unsupported rollout schema/i);
});

test(
  "a source deletion failure rolls back the destination",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-image-gen-unlink-"));
    const workspace = join(root, "workspace");
    const capture = join(root, "capture.json");
    const output = join(workspace, "result.png");
    await mkdir(workspace);
    const bin = await makeFakeCodex(root);

    const result = await run(workspace, ["--output", output], "a red paper kite", {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: join(root, "codex-home"),
      FAKE_CODEX_CAPTURE: capture,
      FAKE_CODEX_SCENARIO: "unlink-failure",
    });

    assert.equal(result.code, 1);
    await assert.rejects(readFile(output), /ENOENT/);
    const invocation = JSON.parse(await readFile(capture, "utf8"));
    assert.equal(await readFile(invocation.artifact, "utf8"), "generated-image");
  },
);

test("an invalid current Codex image option fails without moving its artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-invalid-option-"));
  const codexHome = join(root, "codex-home");
  const bin = await makeFakeCodex(root);
  const output = join(root, "out.png");
  const result = await run(root, ["--output", output], "draw a kite", {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CODEX_HOME: codexHome,
    FAKE_CODEX_CAPTURE: join(root, "capture.json"),
    FAKE_CODEX_SCENARIO: "current-last-images",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /unsupported custom tool call/);
  await assert.rejects(readFile(output), /ENOENT/);
});

test("a computed non-image tool call fails without moving its artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-computed-tool-"));
  const codexHome = join(root, "codex-home");
  const bin = await makeFakeCodex(root);
  const output = join(root, "out.png");
  const result = await run(
    root,
    ["--output", output],
    "draw a kite",
    {
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: codexHome,
      FAKE_CODEX_CAPTURE: join(root, "capture.json"),
      FAKE_CODEX_SCENARIO: "computed-tool-call",
    },
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /unsupported custom tool call/);
  await assert.rejects(readFile(output), /ENOENT/);
});

test("a non-image tool call fails without moving its artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-image-gen-tool-failure-"));
  const workspace = join(root, "workspace");
  const codexHome = join(root, "codex-home");
  const capture = join(root, "capture.json");
  await mkdir(workspace);
  const bin = await makeFakeCodex(root);

  const result = await run(workspace, [], "a red paper kite", {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CODEX_HOME: codexHome,
    FAKE_CODEX_CAPTURE: capture,
    FAKE_CODEX_SCENARIO: "other-tool",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /another tool/i);
  const logMatch = result.stderr.match(/log: ([^;\n]+\.jsonl)/);
  assert.ok(logMatch, result.stderr);
  assert.match(await readFile(logMatch[1], "utf8"), /"thread\.started"/);
  const invocation = JSON.parse(await readFile(capture, "utf8"));
  assert.equal(await readFile(invocation.artifact, "utf8"), "generated-image");
});
