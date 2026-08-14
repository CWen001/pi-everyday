#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

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
const failureContext = { execOutput: "", rollout: null };

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

async function rememberFailureRollout(stdout, codexHome) {
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

async function auditRollout(path, threadId) {
  const events = parseJsonLines(await readFile(path, "utf8"), path);
  const topLevelTypes = new Set([
    "session_meta",
    "turn_context",
    "world_state",
    "response_item",
    "event_msg",
  ]);
  const responseItemTypes = new Set([
    "message",
    "reasoning",
    "image_generation_call",
    "custom_tool_call",
    "custom_tool_call_output",
  ]);
  const eventMessageTypes = new Set([
    "agent_message",
    "image_generation_end",
    "task_complete",
    "task_started",
    "token_count",
    "user_message",
  ]);
  for (const event of events) {
    if (!topLevelTypes.has(event.type)) {
      throw new Error(`unsupported rollout schema: ${event.type || "missing event type"}`);
    }
    const payloadType = event.payload?.type;
    if (
      event.type === "response_item" &&
      typeof payloadType === "string" &&
      payloadType.endsWith("_call") &&
      payloadType !== "image_generation_call" &&
      payloadType !== "custom_tool_call"
    ) {
      throw new Error(`codex used another tool: ${payloadType}`);
    }
    if (
      (event.type === "response_item" && !responseItemTypes.has(payloadType)) ||
      (event.type === "event_msg" && !eventMessageTypes.has(payloadType))
    ) {
      throw new Error(
        `unsupported rollout schema: ${payloadType || "missing payload type"}`,
      );
    }
  }
  const sessionMetadata = events.filter((event) => event.type === "session_meta");
  if (
    sessionMetadata.length !== 1 ||
    sessionMetadata[0].payload?.id !== threadId ||
    sessionMetadata[0].payload?.session_id !== threadId
  ) {
    throw new Error("rollout session metadata did not match the Codex thread id");
  }
  const legacyCalls = events.filter(
    (event) =>
      event.type === "response_item" &&
      event.payload?.type === "image_generation_call",
  );
  if (legacyCalls.length > 1) {
    throw new Error(`expected at most one image_gen call record, found ${legacyCalls.length}`);
  }
  const customCalls = events.filter(
    (event) => event.type === "response_item" && event.payload?.type === "custom_tool_call",
  );
  const customOutputs = events.filter(
    (event) => event.type === "response_item" && event.payload?.type === "custom_tool_call_output",
  );
  if (customCalls.length) {
    if (legacyCalls.length || customCalls.length !== 1 || customOutputs.length !== 1) {
      throw new Error("expected one image_gen custom call and output");
    }
    const call = customCalls[0].payload;
    const output = customOutputs[0].payload;
    const input = /^\/\/ @exec: [^\n]+\nconst result = await tools\.image_gen__imagegen\((\{[\s\S]*\})\);\s*generatedImage\(result\);\s*$/.exec(call.input || "");
    let validInput = false;
    if (input) {
      try {
        const arguments_ = JSON.parse(input[1]);
        validInput = arguments_ !== null && !Array.isArray(arguments_) && typeof arguments_ === "object";
      } catch {}
    }
    if (
      call.name !== "exec" ||
      call.status !== "completed" ||
      !validInput ||
      typeof call.call_id !== "string" ||
      !call.call_id ||
      typeof output.call_id !== "string" ||
      !output.call_id ||
      output.call_id !== call.call_id
    ) {
      throw new Error("codex used an unsupported custom tool call");
    }
  } else if (customOutputs.length) {
    throw new Error("image_gen custom output had no matching call");
  }
  const endings = events.filter(
    (event) =>
      event.type === "event_msg" &&
      event.payload?.type === "image_generation_end",
  );
  if (endings.length !== 1) {
    throw new Error(`expected one image_gen end event, found ${endings.length}`);
  }
  const ending = endings[0].payload;
  if (typeof ending.call_id !== "string" || !ending.call_id) {
    throw new Error("image_gen did not record a valid call id");
  }
  if (legacyCalls.length === 1) {
    const legacy = legacyCalls[0].payload;
    if (legacy.id !== ending.call_id) {
      throw new Error("image_gen call record did not match its end event");
    }
    if (legacy.status !== "generating" && legacy.status !== "completed") {
      throw new Error(`unsupported image_gen call status: ${legacy.status || "missing"}`);
    }
  }
  if (ending.status === "failed") throw new Error("image_gen generation failed");
  if (ending.status !== "completed") {
    throw new Error(`image_gen did not complete: ${ending.status || "missing"}`);
  }
  if (typeof ending.saved_path !== "string" || !ending.saved_path) {
    throw new Error("image_gen did not record one saved artifact");
  }
  return ending.saved_path;
}

async function assertMissing(path) {
  try {
    await access(path);
    throw new Error("output path already exists");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function sameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

async function moveFile(source, destination, expectedInfo) {
  await mkdir(dirname(destination), { recursive: true });
  const sourceHandle = await open(
    source,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const openedInfo = await sourceHandle.stat();
    if (!sameFile(openedInfo, expectedInfo)) {
      throw new Error("generated artifact changed before it could be copied");
    }
    const destinationHandle = await open(destination, "wx");
    try {
      await destinationHandle.writeFile(await sourceHandle.readFile());
    } finally {
      await destinationHandle.close();
    }
    try {
      const currentInfo = await lstat(source);
      if (!sameFile(currentInfo, openedInfo)) {
        throw new Error("generated artifact changed before it could be removed");
      }
      await unlink(source);
    } catch (error) {
      await unlink(destination).catch(() => {});
      throw error;
    }
  } finally {
    await sourceHandle.close();
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
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
  const constrainedPrompt = `${prompt}\n\nCall the built-in image_gen tool exactly once and generate exactly one image. Do not call any other tool. Do not use the Image API, a fallback CLI, or another model.`;
  let execution;
  try {
    execution = await runCodex(args, { input: constrainedPrompt, timeout: 15 * 60_000 });
  } catch (error) {
    failureContext.execOutput = error.stdout || "";
    await rememberFailureRollout(failureContext.execOutput, codexHome);
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
  const generatedRoot = await realpath(join(codexHome, "generated_images"));
  const recordedSource = resolve(
    await auditRollout(rollouts[0], started[0].thread_id),
  );
  const recordedInfo = await lstat(recordedSource);
  if (!recordedInfo.isFile()) {
    throw new Error("recorded artifact is not a regular file");
  }
  const source = await realpath(recordedSource);
  const sourceRelative = relative(generatedRoot, source);
  if (
    sourceRelative === ".." ||
    sourceRelative.startsWith(`..${sep}`) ||
    isAbsolute(sourceRelative)
  ) {
    throw new Error("recorded artifact is outside CODEX_HOME/generated_images");
  }
  const sourceInfo = await stat(source);
  if (!sourceInfo.isFile()) throw new Error("generated artifact is not a regular file");
  await access(source, constants.R_OK);
  const extension = extname(source) || ".png";
  const destination = options.output || resolve(".scratch", "generated-images", `${timestamp()}${extension}`);
  await assertMissing(destination);
  await moveFile(source, destination, sourceInfo);
  process.stdout.write(`${JSON.stringify({ path: destination, referenceImage: Boolean(options.image), mode: "built-in image_gen" })}\n`);
}

async function writeFailureLog(error) {
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

main().catch(async (error) => {
  const failureLog = await writeFailureLog(error);
  let details = failureLog.log
    ? `; log: ${failureLog.log}`
    : `; failure log unavailable: ${failureLog.error?.message || "unknown error"}`;
  if (failureContext.rollout) details += `; rollout: ${failureContext.rollout}`;
  process.stderr.write(`${error.message}${details}\n`);
  process.exitCode = 1;
});
