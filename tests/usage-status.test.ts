import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piEverydayOmp from "../extensions/omp.ts";
import { formatUsageStatus } from "../src/usage-status/format.ts";
import { createOpenAIUsageSource, parseUsagePayload } from "../src/usage-status/openai-source.ts";
import { registerUsageStatus } from "../src/usage-status/register.ts";
import type { UsageSource } from "../src/usage-status/types.ts";

test("OMP registers the same additive usage lifecycle", () => {
  const events: string[] = [];
  const omp = {
    on(name: string) {
      events.push(name);
    },
    registerAssistantTextTransformer() {},
  } as unknown as ExtensionAPI;

  piEverydayOmp(omp);

  assert.ok(events.includes("session_start"));
  assert.ok(events.includes("turn_end"));
  assert.ok(events.includes("session_shutdown"));
});

test("parses and formats primary usage windows", () => {
  const snapshot = parseUsagePayload({
    rate_limit: {
      primary_window: {
        used_percent: 18.4,
        limit_window_seconds: 18000,
        reset_after_seconds: 14100,
      },
      secondary_window: {
        used_percent: 40,
        limit_window_seconds: 604800,
        reset_after_seconds: 486000,
      },
    },
  });
  assert.equal(formatUsageStatus(snapshot), "5h 82% left (3h 55m) · 7d 60% left (5d 15h)");
});

test("clamps malformed percentages", () => {
  const snapshot = parseUsagePayload({
    rate_limit: { primary_window: { used_percent: 120, limit_window_seconds: 3600 } },
  });
  assert.equal(formatUsageStatus(snapshot), "1h 0% left");
});

test("loads usage through the shared provider-level auth API", async () => {
  const payload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "account-1" },
  })).toString("base64url");
  const token = `header.${payload}.signature`;
  let requestedProvider: string | undefined;
  let requestUrl: string | undefined;
  let requestHeaders: Headers | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({
      rate_limit: {
        primary_window: { used_percent: 25, limit_window_seconds: 18000 },
      },
    }), { status: 200 });
  };

  try {
    const ctx = {
      modelRegistry: {
        async getApiKeyForProvider(provider: string) {
          requestedProvider = provider;
          return token;
        },
      },
    } as unknown as ExtensionContext;

    const snapshot = await createOpenAIUsageSource(ctx).load(new AbortController().signal);

    assert.equal(requestedProvider, "openai-codex");
    assert.equal(requestUrl, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(requestHeaders?.get("Authorization"), `Bearer ${token}`);
    assert.equal(requestHeaders?.get("ChatGPT-Account-Id"), "account-1");
    assert.equal(snapshot?.rateLimit?.primary?.remainingPercent, 75);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
  assert.deepEqual(statuses, []);
});
