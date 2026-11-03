import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { registerEmptyTurnRecovery } from "../src/empty-turn-recovery.ts";

type Reply = "read" | "empty" | "done" | "error";

async function fixture(replies: Reply[], extra?: (pi: ExtensionAPI) => void, enabled = true) {
  const directory = await mkdtemp(join(tmpdir(), "pi-everyday-empty-"));
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(body);
    const reply = replies[requests.length - 1] ?? "done";
    if (reply === "error") {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Fixture error", type: "invalid_request_error" } }));
      return;
    }
    const delta = reply === "read"
      ? { role: "assistant", tool_calls: [{ index: 0, id: "fixture-read", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "fixture.txt" }) } }] }
      : { role: "assistant", content: reply === "done" ? "Continued within the original task." : "" };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({
      id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta, finish_reason: reply === "read" ? "tool_calls" : "stop" }],
    })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(directory, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(directory, "models.sqlite"),
    refreshOnCreate: false,
  });
  modelRuntime.registerProvider("empty-turn-fixture", {
    api: "openai-completions",
    apiKey: "local-fixture",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }],
  });
  const model = modelRuntime.getModel("empty-turn-fixture", "fixture");
  assert.ok(model);
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "Synthetic lifecycle verification. Use only the local fixture.",
    extensionFactories: [
      ...(enabled ? [registerEmptyTurnRecovery] : []),
      ...(extra ? [extra] : []),
    ],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const manager = SessionManager.inMemory(directory);
  const { session } = await createAgentSession({
    cwd: directory, agentDir: directory, modelRuntime, model, resourceLoader,
    settingsManager, sessionManager: manager, tools: ["read"], thinkingLevel: "off",
  });
  await session.bindExtensions({});
  await writeFile(join(directory, "fixture.txt"), "Successful fixture read.");
  return {
    session, manager, requests,
    complete: async (agentId = "worker") => {
      manager.appendCustomEntry("pstack-agents", { agent: { id: agentId }, status: "completed" });
      await session.sendCustomMessage({
        customType: "pstack-agent",
        content: "pstack agent finished. Continue the originally authorized task, without extending its six-check budget.",
        display: true,
        details: { agentId, status: "completed", exitCode: 0 },
      }, { triggerTurn: true });
      await session.waitForIdle();
    },
    close: async () => {
      session.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("real Pi reproduces the empty stop without recovery", { timeout: 20000 }, async () => {
  const f = await fixture(["read", "empty", "done"], undefined, false);
  try {
    await f.complete();
    assert.equal(f.requests.length, 2);
    assert.equal(f.session.getLastAssistantText(), undefined);
  } finally { await f.close(); }
});

test("real Pi continues once after a completion, a successful tool and an empty stop", { timeout: 20000 }, async () => {
  const f = await fixture(["read", "empty", "done"], (pi) => {
    pi.on("before_agent_start", () => ({
      message: { customType: "vscode-context", content: "Passive editor selection.", display: false },
    }));
  });
  try {
    await f.complete();
    assert.equal(f.requests.length, 3);
    assert.equal(f.session.getLastAssistantText(), "Continued within the original task.");
    assert.match(f.requests[2], /budget/i);
    assert.ok(f.manager.getBranch().some((e) => e.type === "custom_message" && e.customType === "pi-everyday-empty-turn"));
  } finally { await f.close(); }
});

test("repeated empty output stops visibly; a new completion gets its own one retry", { timeout: 20000 }, async () => {
  const f = await fixture(["empty", "empty", "empty", "done"]);
  try {
    await f.complete();
    assert.equal(f.requests.length, 2);
    const warnings = f.manager.getBranch().filter((e) => e.type === "custom_message" && e.customType === "pi-everyday-empty-turn");
    assert.equal(warnings.length, 2);
    assert.match(JSON.stringify(warnings[1]), /stopped/i);
    await f.complete("next-worker");
    assert.equal(f.requests.length, 4);
  } finally { await f.close(); }
});

test("running workers and scheduled wakeups remain legitimate waits", { timeout: 20000 }, async () => {
  const f = await fixture(["empty", "empty", "empty", "done"]);
  try {
    f.manager.appendCustomEntry("pstack-agents", { agent: { id: "other" }, status: "running" });
    await f.complete();
    assert.equal(f.requests.length, 1);
    f.manager.appendCustomEntry("pstack-agents", { agent: { id: "other" }, status: "completed" });
    f.manager.appendMessage({
      role: "toolResult", toolCallId: "schedule", toolName: "schedule_wakeup",
      content: [{ type: "text", text: "Scheduled" }], isError: false, timestamp: Date.now(),
      details: { fireAt: new Date(Date.now() + 600000).toISOString() },
    });
    await f.complete("second");
    assert.equal(f.requests.length, 2);
    f.manager.appendMessage({
      role: "toolResult", toolCallId: "cancel", toolName: "schedule_wakeup",
      content: [{ type: "text", text: "Cancelled" }], isError: false, timestamp: Date.now(),
      details: { cancelled: true },
    });
    await f.complete("third");
    assert.equal(f.requests.length, 4);
    assert.equal(f.manager.getEntries().filter((e) => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "schedule_wakeup").length, 2);
  } finally { await f.close(); }
});

test("normal replies, ordinary user turns and provider errors are not retried", { timeout: 20000 }, async () => {
  const f = await fixture(["done", "empty", "error"]);
  try {
    await f.complete();
    assert.equal(f.requests.length, 1);
    await f.session.prompt("An ordinary user turn.");
    assert.equal(f.requests.length, 2);
    await f.complete("failed-request");
    assert.equal(f.requests.length, 3);
    assert.equal(f.manager.getEntries().filter((e) => e.type === "custom" && e.customType === "pi-everyday-empty-turn").length, 0);
  } finally { await f.close(); }
});

test("cancellation at the settle boundary suppresses recovery", { timeout: 20000 }, async () => {
  const f = await fixture(["empty", "done"], (pi) => {
    pi.on("agent_before_settle", (_event, ctx) => { ctx.abort(); });
  });
  try {
    await f.complete();
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
