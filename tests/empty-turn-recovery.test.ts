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

type Reply = "read" | "failed-read" | "empty" | "done" | "error" | { text: string };

const STATUS = `目前不需要你操作。我会在本机分别用 Pi 和 Codex 做实际验收。

独立审查、自动合并和中断恢复正在修复。验证证据已改为保存在项目内，避免再生成带后缀的同级目录。

完整流程目前还未验收通过；macOS 仍需要在 Mac 上实测。`;

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
    const toolCall = reply === "read" || reply === "failed-read";
    const delta = toolCall
      ? { role: "assistant", tool_calls: [{ index: 0, id: `fixture-read-${requests.length}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path: reply === "failed-read" ? "missing.txt" : "fixture.txt" }) } }] }
      : { role: "assistant", content: typeof reply === "object" ? reply.text : reply === "done" ? "Continued within the original task." : "" };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({
      id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta, finish_reason: toolCall ? "tool_calls" : "stop" }],
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
      ...(extra ? [extra] : []),
      ...(enabled ? [registerEmptyTurnRecovery] : []),
    ],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const manager = SessionManager.create(directory, join(directory, "sessions"));
  const { session } = await createAgentSession({
    cwd: directory, agentDir: directory, modelRuntime, model, resourceLoader,
    settingsManager, sessionManager: manager, tools: ["read"], thinkingLevel: "off",
  });
  const extensionErrors: unknown[] = [];
  await session.bindExtensions({ onError: (error) => { extensionErrors.push(error); } });
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
      assert.deepEqual(extensionErrors, []);
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

test("incident: three completion replies recover only after the final worker and execute a real read", { timeout: 20000 }, async () => {
  const f = await fixture([{ text: STATUS }, { text: STATUS }, { text: STATUS }, { text: STATUS }, "read", "done"], (pi) => {
    pi.on("before_agent_start", () => ({
      message: { customType: "vscode-context", content: "Passive editor selection.", display: false },
    }));
  });
  try {
    for (const id of ["first", "second", "third"]) {
      f.manager.appendCustomEntry("pstack-agents", { agent: { id }, status: "running" });
    }
    await f.session.prompt("Continue the authorized task after the three workers finish.");
    await f.complete("first");
    await f.complete("second");
    assert.equal(f.requests.length, 3, "running workers suppress recovery");
    await f.complete("third");
    assert.equal(f.requests.length, 6, "last completion must cause one bounded retry and a real read");
    const result = f.manager.getBranch().find((e) => e.type === "message"
      && e.message.role === "toolResult" && e.message.toolName === "read");
    assert.ok(result?.type === "message" && result.message.role === "toolResult");
    assert.equal(result.message.isError, false);
    assert.deepEqual(result.message.content, [{ type: "text", text: "Successful fixture read." }]);
    assert.match(f.requests[4], /six-check budget/);
  } finally { await f.close(); }
});

function receipts(manager: SessionManager) {
  return manager.getEntries().filter((e) => e.type === "custom").filter((e) => e.customType === "pi-everyday-empty-turn");
}

function notices(manager: SessionManager) {
  return manager.getEntries().filter((e) => e.type === "custom_message" && e.customType === "pi-everyday-empty-turn");
}

async function reassess(f: Awaited<ReturnType<typeof fixture>>) {
  await f.session.sendCustomMessage({ customType: "vscode-context", content: "Passive selection.", display: false }, { triggerTurn: true });
  await f.session.waitForIdle();
}

test("repeat comparison normalizes line endings and trailing whitespace, not meaning", { timeout: 20000 }, async (t) => {
  for (const [name, text, matches] of [
    ["whitespace", " \r\nStatus. \t\r\n\r\n  Detail.\t\r\n", true],
    ["case", "status.\n\n  Detail.", false],
    ["punctuation", "Status!\n\n  Detail.", false],
    ["indentation", "Status.\n\n Detail.", false],
    ["paragraph", "Status.\n  Detail.", false],
    ["changed summary", "Work is finished.", false],
  ] as const) {
    await t.test(name, async () => {
      const f = await fixture([{ text: "Status.\n\n  Detail." }, { text }, "done"]);
      try {
        await f.complete("first");
        await f.complete("second");
        assert.equal(f.requests.length, matches ? 3 : 2);
        assert.equal(receipts(f.manager).length, matches ? 1 : 0);
      } finally { await f.close(); }
    });
  }
});

test("repeated valid summaries and human gates receive one reassessment, not permission", { timeout: 20000 }, async (t) => {
  for (const text of ["Finished. All requested checks passed.", "Awaiting your approval before deployment. Shall I proceed?"]) {
    await t.test(text, async () => {
      const f = await fixture(Array.from({ length: 4 }, () => ({ text })));
      try {
        await f.complete("first");
        await f.complete("second");
        assert.equal(f.requests.length, 3);
        assert.equal(receipts(f.manager).length, 2);
        assert.match(JSON.stringify(notices(f.manager)[1]), /stopped automatic recovery/);
        assert.match(f.requests[2], /If awaiting a human, restate the gate and stop/);
        assert.match(f.requests[2], /Do not infer permission from worker completion or this reminder/);
        assert.equal(f.manager.getEntries().filter((e) => e.type === "message" && e.message.role === "toolResult").length, 0);
        await reassess(f);
        assert.equal(f.requests.length, 4);
        assert.equal(notices(f.manager).length, 2, "exhaustion is warned only once");
      } finally { await f.close(); }
    });
  }
});

test("empty and repeated stalls share one exact-completion budget", { timeout: 20000 }, async (t) => {
  const cases: { name: string; replies: Reply[]; warnings: number }[] = [
    { name: "empty to repeated", replies: [{ text: STATUS }, "empty", { text: STATUS }], warnings: 2 },
    { name: "repeated to empty", replies: [{ text: STATUS }, { text: STATUS }, "empty"], warnings: 2 },
    { name: "empty to fresh text", replies: [{ text: STATUS }, "empty", "done"], warnings: 1 },
    { name: "repeated to fresh text", replies: [{ text: STATUS }, { text: STATUS }, "done"], warnings: 1 },
  ];
  for (const { name, replies: output, warnings } of cases) {
    await t.test(name, async () => {
      const f = await fixture(output);
      try {
        await f.complete("first");
        await f.complete("second");
        assert.equal(f.requests.length, 3);
        assert.equal(notices(f.manager).length, warnings);
        const trigger = f.manager.getBranch().reverse().find((e) => e.type === "custom_message" && e.customType === "pstack-agent");
        assert.ok(trigger);
        assert.deepEqual(receipts(f.manager).map((e) => e.data), [
          { triggerId: trigger.id, action: "retry" },
          ...(warnings === 2 ? [{ triggerId: trigger.id, action: "stopped" }] : []),
        ]);
      } finally { await f.close(); }
    });
  }
});

test("successful and failed tools invalidate repeat evidence on either completion", { timeout: 20000 }, async (t) => {
  for (const tool of ["read", "failed-read"] as const) {
    for (const position of ["earlier", "current"]) {
      await t.test(`${tool} on ${position}`, async () => {
        const f = await fixture(position === "earlier"
          ? [tool, { text: STATUS }, { text: STATUS }]
          : [{ text: STATUS }, tool, { text: STATUS }]);
        try {
          await f.complete("first");
          await f.complete("second");
          assert.equal(f.requests.length, 3);
          assert.equal(receipts(f.manager).length, 0);
          const result = f.manager.getEntries().find((e) => e.type === "message" && e.message.role === "toolResult");
          assert.ok(result?.type === "message" && result.message.role === "toolResult");
          assert.equal(result.message.isError, tool === "failed-read");
        } finally { await f.close(); }
      });
    }
  }
});

test("repeat evidence cannot cross user, foreign message, invalid completion or projection gaps", { timeout: 20000 }, async (t) => {
  for (const boundary of ["user", "foreign", "invalid", "omitted reply", "omitted completion", "compaction", "sibling"]) {
    await t.test(boundary, async () => {
      const f = await fixture([{ text: STATUS }, { text: STATUS }]);
      try {
        const root = f.manager.appendMessage({ role: "user", content: "Original task.", timestamp: Date.now() });
        await f.complete("first");
        const reply = f.manager.getLeafId();
        const completion = f.manager.getBranch().find((e) => e.type === "custom_message" && e.customType === "pstack-agent");
        assert.ok(reply && completion);
        if (boundary === "user") f.manager.appendMessage({ role: "user", content: "New task.", timestamp: Date.now() });
        if (boundary === "foreign") f.manager.appendCustomMessageEntry("other", "Other work.", false);
        if (boundary === "invalid") f.manager.appendCustomMessageEntry("pstack-agent", "Invalid completion.", false, { status: "completed" });
        if (boundary === "omitted reply") f.manager.appendContextEdit(reply, null);
        if (boundary === "omitted completion") f.manager.appendContextEdit(completion.id, null);
        if (boundary === "compaction") f.manager.appendCompaction("Earlier reply was identical.", null, 100);
        if (boundary === "sibling") await f.session.navigateTree(root, { summarize: false });
        await f.complete("second");
        assert.equal(f.requests.length, 2);
        assert.equal(receipts(f.manager).length, 0);
      } finally { await f.close(); }
    });
  }
});

test("repeat comparison uses edited text rather than raw history", { timeout: 20000 }, async () => {
  const f = await fixture([{ text: STATUS }, { text: STATUS }]);
  try {
    await f.complete("first");
    const reply = f.manager.getLeafId();
    assert.ok(reply);
    f.manager.appendContextEdit(reply, { content: [{ type: "text", text: "Changed projected summary." }] });
    await f.complete("second");
    assert.equal(f.requests.length, 2);
    assert.equal(receipts(f.manager).length, 0);
  } finally { await f.close(); }
});

test("reload, disk restore, compaction and sibling branches retain legacy retry receipts", { timeout: 20000 }, async (t) => {
  for (const operation of ["reload", "disk restore", "compaction", "sibling"]) {
    await t.test(operation, async () => {
      const f = await fixture([{ text: STATUS }, { text: STATUS }, { text: STATUS }, { text: STATUS }]);
      try {
        await f.complete();
        const trigger = f.manager.getBranch().find((e) => e.type === "custom_message" && e.customType === "pstack-agent");
        const reply = f.manager.getLeafId();
        assert.ok(trigger && reply);
        f.manager.appendCustomEntry("pi-everyday-empty-turn", { triggerId: trigger.id, action: "retry" });
        if (operation === "reload") await f.session.reload();
        if (operation === "disk restore") {
          const path = f.manager.getSessionFile();
          assert.ok(path);
          f.manager.setSessionFile(path);
          await f.session.reload();
        }
        if (operation === "compaction") f.manager.appendCompaction("Earlier task context.", trigger.id, 100);
        if (operation === "sibling") await f.session.navigateTree(reply, { summarize: false });
        await reassess(f);
        assert.equal(f.requests.length, 2, "a restored receipt must not permit another retry");
        assert.equal(receipts(f.manager).length, 2);
        assert.equal(notices(f.manager).length, 1);
        assert.match(JSON.stringify(notices(f.manager)[0]), /stopped automatic recovery/);
        await reassess(f);
        assert.equal(f.requests.length, 3);
        assert.equal(notices(f.manager).length, 1);
      } finally { await f.close(); }
    });
  }
});

test("earlier settle proposals are preserved and only passive editor drafts allow recovery", { timeout: 20000 }, async (t) => {
  for (const proposal of ["passive", "foreign", "state", "context edit", "compaction", "continuation"]) {
    await t.test(proposal, async () => {
      let boundaries = 0;
      const f = await fixture([{ text: STATUS }, { text: STATUS }, "done"], (pi) => {
        pi.on("agent_before_settle", (event, ctx) => {
          if (++boundaries !== 2) return;
          if (proposal === "continuation") return {
            entries: [...event.entries, { type: "custom_message", customType: "foreign", content: "Other continuation.", display: false }], continue: true,
          };
          if (proposal === "state") return { entries: [...event.entries, { type: "custom", customType: "other-state", data: "kept" }] };
          if (proposal === "context edit") {
            const target = ctx.sessionManager.getLeafId();
            assert.ok(target);
            return { entries: [...event.entries, { type: "context_edit", targetId: target, replacement: null }] };
          }
          if (proposal === "compaction") return { entries: [...event.entries, { type: "compaction", summary: "Proposed summary.", firstKeptEntryId: null }] };
          return { entries: [...event.entries, {
            type: "custom_message", customType: proposal === "passive" ? "vscode-context" : "foreign",
            content: "Proposed context.", display: false,
          }] };
        });
      });
      try {
        await f.complete("first");
        await f.complete("second");
        assert.equal(f.requests.length, proposal === "passive" || proposal === "continuation" ? 3 : 2);
        assert.equal(receipts(f.manager).length, proposal === "passive" ? 1 : 0);
        assert.ok(f.manager.getEntries().some((e) =>
          (e.type === "custom" && e.customType === "other-state")
          || (e.type === "custom_message" && (e.customType === "vscode-context" || e.customType === "foreign"))
          || e.type === "context_edit" || e.type === "compaction"), "prior proposal must be committed");
      } finally { await f.close(); }
    });
  }
});

test("queued messages, cancellation and provider errors prevent extra recovery requests", { timeout: 20000 }, async (t) => {
  for (const protection of ["queue", "cancel", "error"]) {
    await t.test(protection, async () => {
      let boundaries = 0;
      const f = await fixture([{ text: STATUS }, protection === "error" ? "error" : { text: STATUS }, "done"], (pi) => {
        pi.on("agent_before_settle", (_event, ctx) => {
          if (++boundaries !== 2) return;
          if (protection === "cancel") ctx.abort();
          if (protection === "queue") pi.sendMessage({ customType: "other", content: "Queued work.", display: false }, { deliverAs: "followUp" });
        });
      });
      try {
        await f.complete("first");
        await f.complete("second");
        assert.equal(f.requests.length, protection === "queue" ? 3 : 2);
        // Pi can commit settle drafts after abort, but must not run their continuation.
        assert.equal(receipts(f.manager).length, protection === "cancel" ? 1 : 0);
        if (protection === "queue") assert.match(f.requests[2], /Queued work/);
      } finally { await f.close(); }
    });
  }
});

test("known and malformed waits suppress repeated replies", { timeout: 20000 }, async (t) => {
  for (const wait of ["running", "future wakeup", "malformed worker", "malformed wakeup"]) {
    await t.test(wait, async () => {
      const f = await fixture([{ text: STATUS }, { text: STATUS }]);
      try {
        if (wait === "running") f.manager.appendCustomEntry("pstack-agents", { agent: { id: "other" }, status: "running" });
        if (wait === "malformed worker") f.manager.appendCustomEntry("pstack-agents", { status: "running" });
        if (wait === "future wakeup" || wait === "malformed wakeup") f.manager.appendMessage({
          role: "toolResult", toolCallId: "schedule", toolName: "schedule_wakeup",
          content: [{ type: "text", text: "Waiting." }], isError: false, timestamp: Date.now(),
          details: { fireAt: wait === "future wakeup" ? new Date(Date.now() + 600000).toISOString() : "invalid" },
        });
        await f.complete("first");
        await f.complete("second");
        assert.equal(f.requests.length, 2);
        assert.equal(receipts(f.manager).length, 0);
      } finally { await f.close(); }
    });
  }
});

test("a first completion does not borrow an ordinary user reply as repeat evidence", { timeout: 20000 }, async () => {
  const f = await fixture([{ text: STATUS }, { text: STATUS }]);
  try {
    await f.session.prompt("Original task.");
    await f.complete();
    assert.equal(f.requests.length, 2);
    assert.equal(receipts(f.manager).length, 0);
  } finally { await f.close(); }
});

test("an empty reply after a failed tool still receives one reassessment", { timeout: 20000 }, async () => {
  const f = await fixture(["failed-read", "empty", "done"]);
  try {
    await f.complete();
    assert.equal(f.requests.length, 3);
    assert.equal(receipts(f.manager).length, 1);
    const result = f.manager.getEntries().find((e) => e.type === "message" && e.message.role === "toolResult");
    assert.ok(result?.type === "message" && result.message.role === "toolResult" && result.message.isError);
  } finally { await f.close(); }
});
