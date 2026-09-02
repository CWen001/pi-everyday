#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

import { transferArtifact } from "./artifact-custody.mjs";
import { auditRollout } from "./rollout.mjs";

const disabledFeatures = [
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
];
const enabledFeatures = ["image_generation"];
const requiredFeatures = [...disabledFeatures, ...enabledFeatures];

const requiredOptions = [
  "--ignore-user-config",
  "--disable",
  "--enable",
  "--sandbox",
  "--skip-git-repo-check",
  "--json",
  "--image",
  "--cd",
];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name !== "--image" && name !== "--output") {
      throw new Error(`unknown option: ${name}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${name} requires a path`);
    const key = name.slice(2);
    if (options[key]) throw new Error(`duplicate option ${name}`);
    options[key] = resolve(value);
    index += 1;
  }
  return options;
}

function runCodex(args, { input, timeout = 30_000 } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const detached = process.platform !== "win32";
    const child = spawn("codex", args, {
      detached,
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let hardStop;

    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardStop);
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        rejectRun(error);
      } else {
        resolveRun(result);
      }
    };
    const signal = (name) => {
      try {
        if (detached && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const timeoutError = () => new Error("codex timed out");
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
        killer.on("close", () => finish(null, timeoutError()));
        killer.on("error", () => finish(null, timeoutError()));
        return;
      }
      signal("SIGTERM");
      hardStop = setTimeout(() => {
        signal("SIGKILL");
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(null, timeoutError());
      }, 2_000);
    }, timeout);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => {
      if (timedOut) return finish(null, timeoutError());
      if (code !== 0) {
        return finish(
          null,
          new Error(`codex exited ${code}: ${stderr.trim() || "no error output"}`),
        );
      }
      finish({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function verifyCodex() {
  const [{ stdout: help }, { stdout: features }] = await Promise.all([
    runCodex(["exec", "--help"]),
    runCodex(["features", "list"]),
  ]);
  for (const option of requiredOptions) {
    if (!help.includes(option)) throw new Error(`codex lacks required option ${option}`);
  }
  for (const feature of requiredFeatures) {
    const match = features.match(new RegExp(`^${feature}\\s+(\\S+)`, "m"));
    if (!match || match[1] === "removed") {
      throw new Error(`codex lacks required feature ${feature}`);
    }
  }
}

async function findRollouts(root, threadId) {
  const matches = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name.endsWith(`-${threadId}.jsonl`)) matches.push(path);
    }
  }
  await visit(root);
  return matches;
}

function parseJsonLines(text, source) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`unsupported JSONL in ${source}`);
      }
    });
}

async function rememberFailureRollout(stdout, codexHome, failureContext) {
  const threadIds = stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line);
        return event.type === "thread.started" && typeof event.thread_id === "string"
          ? [event.thread_id]
          : [];
      } catch {
        return [];
      }
    });
  if (threadIds.length !== 1) return;
  const rollouts = await findRollouts(join(codexHome, "sessions"), threadIds[0]);
  if (rollouts.length === 1) failureContext.rollout = rollouts[0];
}

async function assertMissing(path) {
  try {
    await access(path);
    throw new Error("output path already exists");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(failureContext) {
  const options = parseArgs(process.argv.slice(2));
  const prompt = await new Promise((resolveInput, rejectInput) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => resolveInput(input));
    process.stdin.on("error", rejectInput);
  });
  if (!prompt.trim()) throw new Error("prompt must not be empty");
  if (
    process.platform === "win32" &&
    options.image &&
    /[&|<>()^%!"\r\n]/.test(options.image)
  ) {
    throw new Error("reference image path contains unsupported Windows shell characters");
  }
  if (options.image) {
    const image = await stat(options.image);
    if (!image.isFile()) throw new Error("reference image must be a regular file");
    await access(options.image, constants.R_OK);
  }
  if (options.output) await assertMissing(options.output);

  await verifyCodex();
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const isolatedCwd = await mkdtemp(join(tmpdir(), "codex-image-gen-"));
  const args = [
    "exec",
    "--ignore-user-config",
    ...disabledFeatures.flatMap((feature) => ["--disable", feature]),
    ...enabledFeatures.flatMap((feature) => ["--enable", feature]),
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--json",
    "--cd", isolatedCwd,
    "-",
  ];
  if (options.image) args.push("--image", options.image);
  const constrainedPrompt = `${prompt}\n\nYour first and only tool call must be the built-in image_gen tool, exactly once, generating exactly one image; return immediately after it completes. Never call apply_patch, even with an empty patch. Do not use the Image API, a fallback CLI, or another model.`;
  let execution;
  try {
    execution = await runCodex(args, { input: constrainedPrompt, timeout: 15 * 60_000 });
  } catch (error) {
    failureContext.execOutput = error.stdout || "";
    await rememberFailureRollout(failureContext.execOutput, codexHome, failureContext);
    throw error;
  } finally {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
  failureContext.execOutput = execution.stdout;
  const execEvents = parseJsonLines(execution.stdout, "codex exec stdout");
  const started = execEvents.filter(
    (event) => event.type === "thread.started" && typeof event.thread_id === "string",
  );
  if (started.length !== 1) throw new Error("codex did not report one thread id");

  const rollouts = await findRollouts(join(codexHome, "sessions"), started[0].thread_id);
  if (rollouts.length !== 1) {
    throw new Error(`expected one matching rollout, found ${rollouts.length}`);
  }
  failureContext.rollout = rollouts[0];
  const rolloutEvents = parseJsonLines(
    await readFile(rollouts[0], "utf8"),
    rollouts[0],
  );
  const { savedPath } = auditRollout(rolloutEvents, started[0].thread_id);
  const destination =
    options.output ||
    resolve(
      ".scratch",
      "generated-images",
      `${timestamp()}${extname(savedPath) || ".png"}`,
    );
  await assertMissing(destination);
  await transferArtifact({
    source: savedPath,
    destination,
    generatedRoot: join(codexHome, "generated_images"),
  });
  process.stdout.write(`${JSON.stringify({ path: destination, referenceImage: Boolean(options.image), mode: "built-in image_gen" })}\n`);
}

async function writeFailureLog(error, failureContext) {
  const diagnostic = JSON.stringify({
    type: "codex_image_gen.failure",
    error: error.message,
    rollout: failureContext.rollout,
  });
  const events = failureContext.execOutput.trimEnd();
  const body = `${events ? `${events}\n` : ""}${diagnostic}\n`;
  let lastError;
  for (const directory of [
    resolve(".scratch", "codex-image-gen", "failures"),
    join(tmpdir(), "codex-image-gen-failures"),
  ]) {
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const log = join(directory, `${timestamp()}-${process.pid}.jsonl`);
      await writeFile(log, body, { flag: "wx", mode: 0o600 });
      return { log };
    } catch (writeError) {
      lastError = writeError;
    }
  }
  return { error: lastError };
}

async function runInvocation() {
  const failureContext = { execOutput: "", rollout: null };
  try {
    await main(failureContext);
  } catch (error) {
    const failureLog = await writeFailureLog(error, failureContext);
    let details = failureLog.log
      ? `; log: ${failureLog.log}`
      : `; failure log unavailable: ${failureLog.error?.message || "unknown error"}`;
    if (failureContext.rollout) details += `; rollout: ${failureContext.rollout}`;
    process.stderr.write(`${error.message}${details}\n`);
    process.exitCode = 1;
  }
}

await runInvocation();
