#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { transferArtifact } from "./artifact-custody.mjs";
import { auditRollout } from "./rollout.mjs";

const disabledFeatures = ["multi_agent", "multi_agent_v2", "shell_tool", "unified_exec", "apps", "plugins", "browser_use", "computer_use", "skill_search", "hooks", "tool_suggest", "unbounded_connection_retries"];
const requestTimeout = 30 * 60_000;
const runTimeout = 15 * 60_000;

function parseArgs(argv) {
  const options = { images: [], maxSubmissions: 3 };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!["--image", "--output", "--max-submissions"].includes(name)) throw new Error(`unknown option: ${name}`);
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
    if (name === "--max-submissions") {
      if (!/^[1-3]$/.test(value)) throw new Error("--max-submissions must be 1, 2 or 3");
      options.maxSubmissions = Number(value);
    } else if (name === "--image") options.images.push(resolve(value));
    else {
      if (options.output) throw new Error("duplicate option --output");
      options.output = resolve(value);
    }
  }
  return options;
}

function safeMessage(value) {
  return String(value).replace(/[A-Za-z0-9+/]{64,}={0,2}/g, "[omitted encoded data]").slice(0, 1500);
}

function runCodex(args, { input, timeout = 30_000 } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    // Windows .cmd launchers require cmd.exe. Quote every argument and reject
    // expansion syntax; prompts always travel on stdin, never through the shell.
    if (process.platform === "win32" && args.some((arg) => /[%!"\r\n]/.test(arg))) {
      rejectRun(new Error("unsupported Windows command argument")); return;
    }
    const windows = process.platform === "win32";
    const child = windows
      ? spawn(`codex ${args.map((arg) => `"${arg}"`).join(" ")}`, { shell: true, stdio: ["pipe", "pipe", "pipe"] })
      : spawn("codex", args, { detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false, timedOut = false, hardStop;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(hardStop);
      if (error) { error.stdout = stdout; error.stderr = stderr; rejectRun(error); }
      else resolveRun({ stdout, stderr });
    };
    const signal = (name) => {
      try { process.kill(-child.pid, name); } catch (error) { if (error.code !== "ESRCH") finish(error); }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (windows && child.pid) {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        killer.on("error", () => child.kill());
        hardStop = setTimeout(() => {
          killer.kill(); child.kill();
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
          finish(new Error("codex timed out; process-tree termination unconfirmed"));
        }, 10_000);
      } else {
        signal("SIGTERM");
        hardStop = setTimeout(() => {
          signal("SIGKILL");
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
          finish(new Error("codex timed out"));
        }, 2_000);
      }
    }, timeout);
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE") finish(error); });
    child.on("error", finish);
    child.on("close", (code) => finish(timedOut ? new Error("codex timed out") :
      code !== 0 ? new Error(`codex exited ${code}: ${safeMessage(stderr.trim() || "no error output")}`) : null));
    child.stdin.end(input);
  });
}

async function capabilities() {
  const [version, help, features] = await Promise.all([
    runCodex(["--version"]), runCodex(["exec", "--help"]), runCodex(["features", "list"]),
  ]);
  for (const option of ["--ignore-user-config", "--sandbox", "--skip-git-repo-check", "--json", "--image", "--cd"]) {
    if (!help.stdout.includes(option)) throw new Error(`Codex ${version.stdout.trim()} lacks ${option}; update Codex using its existing installation method`);
  }
  const available = new Set(features.stdout.split("\n").filter((line) => !/\sremoved\s/.test(line)).map((line) => line.trim().split(/\s+/)[0]));
  return {
    version: version.stdout.trim(),
    flags: [...disabledFeatures.filter((name) => available.has(name)).flatMap((name) => ["--disable", name]),
      ...(available.has("image_generation") ? ["--enable", "image_generation"] : [])],
  };
}

async function findRollouts(root, threadId) {
  const matches = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`)) matches.push(path);
    }
  }
  await visit(root);
  return matches;
}

function jsonLines(text) {
  let incomplete = false;
  const events = text.split("\n").filter((line) => line.trim()).flatMap((line) => {
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string" || !event.type) {
        incomplete = true; return [];
      }
      return [event];
    } catch { incomplete = true; return []; }
  });
  return { events, incomplete };
}

async function inspect(run, codexHome) {
  const stdout = jsonLines(run.stdout);
  const ids = new Set(stdout.events.filter((event) => event.type === "thread.started").map((event) => event.thread_id));
  if (ids.size !== 1 || !/^[a-zA-Z0-9_-]+$/.test([...ids][0] || "")) throw new Error("Codex did not report one valid thread id");
  run.threadId = [...ids][0];
  const paths = await findRollouts(join(codexHome, "sessions"), run.threadId);
  if (paths.length !== 1) throw new Error(`expected one matching rollout, found ${paths.length}`);
  run.rollout = paths[0];
  const parsed = jsonLines(await readFile(run.rollout, "utf8"));
  const evidence = auditRollout(parsed.events, run.threadId);
  if (stdout.incomplete || parsed.incomplete) {
    evidence.check.warnings.push("some execution records could not be decoded");
    if (evidence.check.status !== "violation") evidence.check.status = "incomplete";
  }
  Object.assign(run, evidence);
  run.countUncertain = evidence.countUncertain || stdout.incomplete || parsed.incomplete;
}

async function assertMissing(path) {
  try { await access(path); throw new Error("output path already exists"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

function snapshot(report) {
  return { ...report, runs: report.runs.map(({ stdout, artifacts, failures, toolErrors, ...run }) => ({
    ...run, artifacts: (artifacts || []).map(({ callId, savedPath, data }) => ({ callId, savedPath, inline: Boolean(data) })),
    failures: (failures || []).map((failure) => safeMessage(JSON.stringify(failure))),
    toolErrors: (toolErrors || []).map(safeMessage),
  })) };
}

async function diagnostic(report) {
  for (const directory of [resolve(".scratch", "codex-image-gen", "runs"), join(tmpdir(), "codex-image-gen-runs")]) {
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, `${report.id}.json`);
      await writeFile(path, JSON.stringify(snapshot(report), null, 2), { flag: "wx", mode: 0o600 });
      return path;
    } catch { /* Try the private temporary directory if the workspace is unwritable. */ }
  }
  return null;
}

async function deliver(run, report, options, codexHome) {
  for (const artifact of run.artifacts || []) {
    if (report.images.some((image) => image.attempt === run.attempt && image.callId === artifact.callId)) continue;
    const destination = options.output && !options.outputUsed ? options.output :
      resolve(".scratch", "generated-images", `${report.id}-${run.attempt}-${report.images.length + 1}.png`);
    options.outputUsed = true;
    const request = { source: artifact.savedPath, data: artifact.data, destination,
      generatedRoot: join(codexHome, "generated_images"), threadId: run.threadId };
    try {
      try { await transferArtifact(request); }
      catch (error) {
        if ((error.code === "ENOENT" || /could not be decoded/.test(error.message)) && artifact.data) {
          await transferArtifact({ ...request, source: undefined });
          run.check.warnings.push("saved artifact unavailable; recovered returned image data");
        } else if (["EBUSY", "EAGAIN", "EMFILE"].includes(error.code)) {
          await sleep(100); await transferArtifact(request);
        } else throw error;
      }
      report.images.push({ attempt: run.attempt, callId: artifact.callId, path: destination,
        source: artifact.savedPath || "inline result in rollout", recovered: Boolean(run.error || run.attempt < report.runs.length) });
    } catch (error) {
      report.errors.push(`attempt ${run.attempt} delivery: ${safeMessage(error.message)}`);
      if (error.validSource) report.images.push({ attempt: run.attempt, callId: artifact.callId,
        path: error.validSource, source: error.validSource, delivery: "original-only", requestedDestination: destination, recovered: true });
    }
  }
}

function retryDecision(runs, deadline) {
  let delay = 0, notBefore = 0, reason = "";
  for (const run of runs) {
    const evidence = JSON.stringify([run.failures, run.toolErrors, run.error]);
    reason = safeMessage(evidence);
    if (run.countUncertain || /termination unconfirmed/.test(evidence)) {
      return { retry: false, reason: "generation count or process termination is uncertain; no further submission" };
    }
    if (run.pending) return { retry: false, reason: "an image task remains pending; no further submission" };
    if (/login|authenticat|unauthoriz|refus|content.?policy|safety|invalid.?request|invalid.?argument|permission.?denied|billing|quota/i.test(evidence)) {
      return { retry: false, reason };
    }
    if (/rate.?limit|usage.?limit|usageLimit|429/i.test(evidence)) {
      const reset = (run.failures || []).map((failure) => failure?.resets_at ?? failure?.resetsAt).find(Number.isFinite);
      const wait = reset == null ? NaN : Math.max(1000, reset * 1000 - Date.now());
      if (!Number.isFinite(wait) || wait > 60_000 || Date.now() + wait >= deadline) return { retry: false, reason };
      delay = Math.max(delay, wait);
      notBefore = Math.max(notBefore, reset * 1000);
    } else {
      if (!run.submissions || !(run.failures?.length || /timed out|connection|network|temporar|server.error|503|502/i.test(evidence))) {
        return { retry: false, reason };
      }
      delay = Math.max(delay, run.attempt * 1000);
    }
  }
  return { retry: true, delay, notBefore, reason };
}

async function recoverRuns(report, options, codexHome) {
  for (const run of report.runs) {
    if (run.rollout) {
      try { await inspect(run, codexHome); }
      catch (error) { report.errors.push(safeMessage(error.message)); continue; }
    }
    await deliver(run, report, options, codexHome);
    report.errors.push(...(run.evidenceErrors || []));
    if (run.check.status === "violation") report.errors.push(...run.check.violations);
  }
  report.submissions = report.runs.reduce((total, run) => total + (run.submissions || 0), 0);
  if (report.submissions > options.maxSubmissions) report.errors.push("Codex exceeded the generation budget; no further runs authorized");
}

async function main(report) {
  const options = parseArgs(process.argv.slice(2));
  const maxAttempts = options.maxSubmissions;
  report.maxSubmissions = maxAttempts;
  let prompt = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) prompt += chunk;
  if (!prompt.trim()) throw new Error("prompt must not be empty");
  for (const image of options.images) {
    if (!(await stat(image)).isFile()) throw new Error("reference image must be a regular file");
    await access(image, constants.R_OK);
  }
  if (options.output) await assertMissing(options.output);
  const { version, flags } = await capabilities();
  report.codexVersion = version;
  report.referenceImage = options.images.length > 0;
  report.referenceImages = options.images;
  const codexHome = resolve(process.env.CODEX_HOME || join(homedir(), ".codex"));
  const deadline = Date.now() + requestTimeout;
  const isolatedCwd = await mkdtemp(join(tmpdir(), "codex-image-gen-"));
  const args = ["exec", "--ignore-user-config", "-c", "web_search=disabled", ...flags,
    "--sandbox", "read-only", "--skip-git-repo-check", "--json", "--cd", isolatedCwd];
  const referenceInstruction = options.images.length
    ? `The ordered reference images are attached and have these local paths: ${JSON.stringify(options.images)}. Follow the native image tool guidance for local paths and conversation references. If the filesystem bridge cannot read these paths, recover using the already attached images with the smallest conversation-image window covering all supplied references. Do not combine both reference mechanisms.`
    : "No reference images were supplied. Generate from the user prompt alone.";
  const input = `${prompt}\n\nExecution instructions (not creative changes): Use Codex's built-in image_gen for exactly one generation submission in this run. Follow its native tool contract, including supported transparency options. ${referenceInstruction} Keep the user's creative request unchanged. The outer runner owns retries: after a generation error, return the terminal error instead of making another generation submission. Local reference-reading repairs before submission and necessary view_image calls are allowed. For an exec wrapper, give the initial call 120 seconds and use repeated waits on that SAME running cell until it completes; return the generated image with generatedImage(result), never print base64. All creative instructions are already provided: no web research, unrelated file changes, other image services or fallback CLI. Report a terminal outcome; do not stop while the image task is still running.`;
  try {
    for (let attempt = 1; attempt <= maxAttempts && Date.now() < deadline; attempt += 1) {
      if (attempt > 1) {
        await recoverRuns(report, options, codexHome);
        if (report.images.length || report.errors.length || report.submissions >= maxAttempts) break;
        const decision = retryDecision(report.runs, deadline);
        if (!decision.retry) { report.errors.push(decision.reason); break; }
        if (decision.notBefore > Date.now()) {
          report.errors.push("refreshed evidence extends the rate-limit wait; no further submission"); break;
        }
      }
      const run = { attempt, stdout: "", check: { status: "incomplete", warnings: [], violations: [] } };
      report.runs.push(run);
      try {
        const execution = await runCodex([...args, ...options.images.flatMap((path) => ["--image", path]), "-"], {
          input, timeout: Math.min(runTimeout, deadline - Date.now()),
        });
        run.stdout = execution.stdout;
      } catch (error) { run.stdout = error.stdout || ""; run.error = safeMessage(error.message); }
      try {
        await inspect(run, codexHome);
        // A premature turn end is not a new Image Run. Resume only the recorded
        // thread and instruct it to wait, never to replace the pending task.
        if (run.pending && !run.error && Date.now() < deadline) {
          run.resumed = true;
          const resumed = await runCodex([...args, "resume", run.threadId, "-"], {
            input: "Continue waiting on the SAME existing image task/cell using the native wait tool. No new generation submission is authorized. Return its image or terminal failure. If that task no longer exists, report that fact and stop.",
            timeout: Math.min(runTimeout, deadline - Date.now()),
          });
          run.stdout += `\n${resumed.stdout}`;
          await inspect(run, codexHome);
        }
      } catch (error) {
        run.error = [run.error, safeMessage(error.message)].filter(Boolean).join("; ");
      }
      // Re-read known runs before any new submission. A late result wins over a retry.
      await recoverRuns(report, options, codexHome);
      if (report.images.length || report.errors.length) break;
      const decision = retryDecision(report.runs, deadline);
      if (!decision.retry || report.submissions >= maxAttempts || attempt === maxAttempts || Date.now() + decision.delay >= deadline) {
        report.errors.push(run.error || decision.reason || "no valid image was delivered");
        break;
      }
      run.retryReason = decision.reason;
      await sleep(decision.delay);
    }
  } finally { await rm(isolatedCwd, { recursive: true, force: true }); }
  if (!report.images.length && !report.errors.length) report.errors.push("Image Request deadline reached without a valid image");
  report.images.sort((a, b) => a.attempt - b.attempt);
  report.path = report.images[0]?.path;
  report.status = report.errors.length ? report.images.length ? "partial" : "failed" : "completed";
}

const report = { id: randomUUID(), mode: "built-in image_gen", images: [], runs: [], errors: [] };
try { await main(report); }
catch (error) { report.errors.push(safeMessage(error.message)); report.status = report.images.length ? "partial" : "failed"; }
report.diagnostic = await diagnostic(report);
process.stdout.write(`${JSON.stringify(snapshot(report))}\n`);
if (report.status !== "completed") {
  process.stderr.write(`${report.errors.join("; ")}; log: ${report.diagnostic || "unavailable"}\n`);
  process.exitCode = 1;
}
