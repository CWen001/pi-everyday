import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerUsageStatus } from "../src/usage-status/register.ts";
import type { UsageSource } from "../src/usage-status/types.ts";

test("native status shows both usage windows and reset durations", async () => {
  const h = usageHarness({ async load() { return {
    rateLimit: {
      primary: { usedPercent: 18.4, remainingPercent: 81.6, windowSeconds: 18000, resetAfterSeconds: 14100 },
      secondary: { usedPercent: 40, remainingPercent: 60, windowSeconds: 604800, resetAfterSeconds: 486000 },
    }, additionalRateLimits: [],
  }; } });
  h.emit("session_start"); await flush();
  assert.equal(h.statuses.at(-1), "5h 82% left (3h 55m) · 7d 60% left (5d 15h)");
  h.emit("session_shutdown");
});

function usageHarness(source?: UsageSource, modelRegistry?: ExtensionContext["modelRegistry"]) {
  type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
  const handlers = new Map<string, Handler>();
  const statuses: Array<string | undefined> = [];
  let clock = 1_000_000;
  const pi = { on(name: string, handler: Handler) { handlers.set(name, handler); } } as unknown as ExtensionAPI;
  const ctx = { hasUI: true, modelRegistry, ui: {
    setStatus(key: string, value: string | undefined) {
      assert.equal(key, "pi-everyday-usage");
      statuses.push(value);
    },
    theme: { fg(_color: string, value: string) { return value; } },
  } } as unknown as ExtensionContext;
  registerUsageStatus(pi, { now: () => clock, ...(source ? { sourceFactory: () => source } : {}) });
  return { statuses, ctx, advance(ms: number) { clock += ms; },
    emit(name: string, context = ctx) { return handlers.get(name)?.({}, context); } };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const availableUsage = { rateLimit: { primary: { usedPercent: 25, remainingPercent: 75, windowSeconds: 18000 } }, additionalRateLimits: [] };

test("unverified subscription quota remains hidden without accessing credentials or backend endpoints", async (t) => {
  let credentials = 0, requests = 0;
  const registry = { async getApiKeyForProvider() {
    credentials++;
    return `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "legacy-account" } })).toString("base64url")}.signature`;
  } } as unknown as ExtensionContext["modelRegistry"];
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("unexpected quota request"); });
  const h = usageHarness(undefined, registry);
  h.emit("session_start"); await flush();
  assert.equal(credentials, 0);
  assert.equal(requests, 0);
  assert.ok(h.statuses.every((status) => status === undefined));
  h.emit("session_shutdown");
});

test("session events return while optional usage is still pending", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = usageHarness({ load: () => new Promise(() => {}) });
  assert.equal(h.emit("session_start"), undefined);
  assert.equal(h.emit("turn_end"), undefined);
  h.emit("session_shutdown");
});

test("a failed refresh hides the previous value and a later success restores it", async () => {
  let failing = false;
  const h = usageHarness({ async load() { if (failing) throw new Error("offline"); return availableUsage; } });
  h.emit("session_start"); await flush();
  assert.equal(h.statuses.at(-1), "5h 75% left");
  failing = true; h.advance(300_000);
  h.emit("turn_end"); await flush();
  assert.equal(h.statuses.at(-1), undefined);
  failing = false; h.advance(300_000);
  h.emit("turn_end"); await flush();
  assert.equal(h.statuses.at(-1), "5h 75% left");
  h.emit("session_shutdown");
});

test("the whole refresh expires even when its source ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let loads = 0;
  let finishSlow!: (value: typeof availableUsage) => void;
  const h = usageHarness({ load() {
    loads++;
    return loads === 2 ? new Promise((resolve) => { finishSlow = resolve; }) : Promise.resolve(availableUsage);
  } });
  h.emit("session_start"); await flush();
  h.advance(300_000); h.emit("turn_end"); await flush();
  t.mock.timers.tick(10_000); await flush();
  assert.equal(h.statuses.at(-1), undefined);
  h.advance(300_000); h.emit("turn_end"); await flush();
  assert.equal(loads, 3);
  assert.equal(h.statuses.at(-1), "5h 75% left");
  finishSlow({ ...availableUsage, rateLimit: { primary: { usedPercent: 90, remainingPercent: 10, windowSeconds: 18000 } } });
  await flush();
  assert.equal(h.statuses.at(-1), "5h 75% left");
  h.emit("session_shutdown");
});

test("session replacement cancels old work without clearing the successor's refresh", async () => {
  const completions: Array<(value: typeof availableUsage) => void> = [];
  const signals: AbortSignal[] = [];
  const h = usageHarness({ load(signal) {
    signals.push(signal);
    return new Promise((resolve) => completions.push(resolve));
  } });
  h.emit("session_start"); await flush();
  h.emit("session_start"); await flush();
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  completions[0](availableUsage); await flush();
  assert.equal(h.statuses.at(-1), undefined);
  h.advance(300_000); h.emit("turn_end"); await flush();
  assert.equal(signals.length, 2, "late cleanup must not release the successor's active slot");
  completions[1](availableUsage); await flush();
  assert.equal(h.statuses.at(-1), "5h 75% left");
  h.emit("session_start", { hasUI: false } as ExtensionContext); await flush();
  h.emit("turn_end", { hasUI: false } as ExtensionContext); await flush();
  assert.equal(signals.length, 2);
  h.emit("session_shutdown", { hasUI: false } as ExtensionContext);
});

test("registers an additive status with cooldown and no footer replacement", async () => {
  type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
  const handlers = new Map<string, Handler>();
  const statuses: Array<string | undefined> = [];
  let loadCount = 0;
  let clock = 1_000_000;

  const source: UsageSource = {
    async load() {
      loadCount += 1;
      return {
        rateLimit: {
          primary: { usedPercent: 25, remainingPercent: 75, windowSeconds: 18000 },
        },
        additionalRateLimits: [],
      };
    },
  };

  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    hasUI: true,
    ui: {
      setStatus(_key: string, value: string | undefined) {
        statuses.push(value);
      },
      theme: { fg(_color: string, value: string) { return value; } },
    },
  } as unknown as ExtensionContext;

  registerUsageStatus(pi, { now: () => clock, sourceFactory: () => source });
  await handlers.get("session_start")?.({}, ctx);
  await flush();
  assert.equal(loadCount, 1);
  assert.equal(statuses.at(-1), "5h 75% left");

  await handlers.get("turn_end")?.({}, ctx);
  assert.equal(loadCount, 1, "refresh is suppressed during the cooldown");

  clock += 5 * 60 * 1000;
  await handlers.get("turn_end")?.({}, ctx);
  assert.equal(loadCount, 2);

  await handlers.get("session_shutdown")?.({}, ctx);
  assert.equal(statuses.at(-1), undefined);
});

test("optional usage failures stay silent", async () => {
  type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
  const handlers = new Map<string, Handler>();
  const statuses: Array<string | undefined> = [];
  const pi = {
    on(name: string, handler: Handler) { handlers.set(name, handler); },
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: true,
    ui: {
      setStatus(_key: string, value: string | undefined) { statuses.push(value); },
      theme: { fg(_color: string, value: string) { return value; } },
    },
  } as unknown as ExtensionContext;
  const source: UsageSource = { async load() { throw new Error("offline"); } };

  registerUsageStatus(pi, { sourceFactory: () => source });
  await handlers.get("session_start")?.({}, ctx);
  await flush();
  assert.ok(statuses.length > 0);
  assert.ok(statuses.every((status) => status === undefined));
});
