import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { imageBase64, imageBytes } from "./image.mjs";
const args = process.argv.slice(2);
const scenario = process.env.FAKE_CODEX_SCENARIO || "success";
if (args.includes("--version")) { console.log("codex-cli 0.150.1"); process.exit(); }
if (args.includes("--help")) {
  console.log("--ignore-user-config --disable --enable --sandbox --skip-git-repo-check --json --image --cd"); process.exit();
}
if (args[0] === "features") {
  console.log((scenario === "evolved-features" ? ["image_generation", "view_image"] :
    ["image_generation", "multi_agent", "shell_tool", "unified_exec", "apps", "plugins", "browser_use", "computer_use", "skill_search", "hooks", "tool_suggest"])
    .map((name) => `${name} stable true`).join("\n")); process.exit();
}
const capture = process.env.FAKE_CODEX_CAPTURE;
const history = existsSync(capture) ? readFileSync(capture, "utf8").trim().split("\n").map(JSON.parse) : [];
const resume = args.includes("resume");
const attempt = history.filter((run) => !run.resume).length + (resume ? 0 : 1);
const threadId = `019ec414-6cbd-7a21-96f6-${String(attempt).padStart(12, "0")}`;
const root = join(process.env.CODEX_HOME, "generated_images", threadId);
const artifact = scenario === "outside-path" ? join(process.env.CODEX_HOME, "unrelated.png") : join(root, "image-1.png");
const prompt = readFileSync(0, "utf8");
appendFileSync(capture, JSON.stringify({ args, prompt, threadId, artifact, resume }) + "\n");
mkdirSync(root, { recursive: true });
const metadata = { type: "session_meta", payload: { id: threadId, session_id: threadId } };
const begin = (id) => ({ type: "event_msg", payload: { type: "image_generation_begin", call_id: id } });
const ending = (id, fields) => ({ type: "event_msg", payload: { type: "image_generation_end", call_id: id, status: "completed", saved_path: artifact, ...fields } });
const events = [metadata, begin("image-1")];
const fail = ["always-fail", "inner-budget", "over-budget"].includes(scenario) || ((scenario === "retry" || scenario === "inner-retry" || scenario === "late-result") && attempt === 1);
if (fail || ["login", "refusal", "rate-limit"].includes(scenario) || (scenario === "rate-reset" && attempt === 1)) {
  events.push(ending("image-1", { status: "failed", saved_path: null,
    failure: scenario === "rate-reset" ? { type: "usage_limit_exceeded", resets_at: Math.floor(Date.now() / 1000) } : { message: fail ? "temporary server error" : scenario, code: fail ? "server_error" : scenario } }));
  const innerCount = scenario === "inner-retry" ? 2 : scenario === "inner-budget" ? 3 : scenario === "over-budget" ? 4 : 1;
  for (let index = 2; index <= innerCount; index++) events.push(begin(`image-${index}`), ending(`image-${index}`, { status: "failed", saved_path: null, failure: { code: "server_error" } }));
} else if (scenario === "pending" && !resume) {
  // The coordinator must resume this session, not generate a new image.
} else {
  writeFileSync(artifact, scenario === "invalid-image" ? "not an image" : imageBytes);
  if (scenario === "inline") events.push(ending("image-1", { saved_path: null, result: imageBase64 }));
  else events.push(ending("image-1", {}));
}
if (scenario === "duplicate") events.push({ type: "event_msg", payload: { type: "item_completed", thread_id: threadId,
  item: { type: "Extension", kind: "image_gen.generation", id: "image-1", status: "completed", savedPath: artifact } } });
if (scenario === "unknown-schema") events.push({ type: "event_msg", payload: { type: "future_event", field: "new" } });
if (scenario === "wrong-session") events[0].payload.id = "other-session";
if (scenario === "other-tool") events.push({ type: "response_item", payload: { type: "function_call", name: "apply_patch" } });
if (scenario === "opaque-wrapper") events.push({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "await arbitraryJavascript()" } });
if (scenario === "legitimate-tools") {
  for (const name of ["view_image", "wait", "wait"]) events.push({ type: "response_item", payload: { type: "function_call", name, arguments: "{}" } });
}
if (scenario === "partial") {
  const bad = join(root, "image-2.png");
  writeFileSync(bad, "invalid image");
  events.push(begin("image-2"), ending("image-2", { saved_path: bad }));
}
if (scenario === "output-race") writeFileSync(process.env.FAKE_OUTPUT, "keep existing");
const rollout = join(process.env.CODEX_HOME, "sessions", "2026", "rollout-" + threadId + ".jsonl");
mkdirSync(dirname(rollout), { recursive: true });
if (scenario !== "missing-rollout") writeFileSync(rollout, events.map(JSON.stringify).join("\n") + "\n");
if (scenario === "late-result" && attempt === 2) {
  const previous = history[0];
  writeFileSync(previous.artifact, imageBytes);
  const oldRollout = join(process.env.CODEX_HOME, "sessions", "2026", "rollout-" + previous.threadId + ".jsonl");
  const oldEvents = readFileSync(oldRollout, "utf8").trim().split("\n").map(JSON.parse);
  oldEvents.push(ending("image-1", { saved_path: previous.artifact }));
  writeFileSync(oldRollout, oldEvents.map(JSON.stringify).join("\n") + "\n");
}
console.log(JSON.stringify({ type: "thread.started", thread_id: threadId }));
if (scenario === "hang") { setInterval(() => {}, 1000); }
else if (scenario === "nonzero") { console.error("connection lost after generation"); process.exitCode = 7; }
else console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
if (scenario === "malformed") console.log("{truncated record");
