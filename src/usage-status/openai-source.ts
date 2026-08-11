import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RateLimit, UsageSnapshot, UsageSource, UsageWindow } from "./types.ts";

const PROVIDER_ID = "openai-codex";
const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api";
const USAGE_PATH = "/wham/usage";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseWindow(value: unknown): UsageWindow | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const usedPercent = finiteNumber(record.used_percent ?? record.usedPercent);
  if (usedPercent === undefined) return undefined;

  const boundedUsed = Math.min(100, Math.max(0, usedPercent));
  return {
    usedPercent: boundedUsed,
    remainingPercent: 100 - boundedUsed,
    windowSeconds: finiteNumber(record.limit_window_seconds ?? record.windowSeconds),
    resetAfterSeconds: finiteNumber(record.reset_after_seconds ?? record.resetAfterSeconds),
  };
}

function parseRateLimit(value: unknown): RateLimit | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    limitReached:
      typeof record.limit_reached === "boolean"
        ? record.limit_reached
        : typeof record.limitReached === "boolean"
          ? record.limitReached
          : undefined,
    primary: parseWindow(record.primary_window ?? record.primaryWindow),
    secondary: parseWindow(record.secondary_window ?? record.secondaryWindow),
  };
}

export function parseUsagePayload(value: unknown): UsageSnapshot {
  const record = asRecord(value) ?? {};
  const additionalRateLimits: UsageSnapshot["additionalRateLimits"] = [];

  if (Array.isArray(record.additional_rate_limits)) {
    for (const value of record.additional_rate_limits) {
      const entry = asRecord(value);
      if (entry) additionalRateLimits.push({ rateLimit: parseRateLimit(entry.rate_limit) });
    }
  }

  return {
    rateLimit: parseRateLimit(record.rate_limit ?? record.rateLimit),
    additionalRateLimits,
  };
}

function decodeAccountId(accessToken: string): string | undefined {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return undefined;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    return asRecord(claims["https://api.openai.com/auth"])?.chatgpt_account_id as
      | string
      | undefined;
  } catch {
    return undefined;
  }
}

export function createOpenAIUsageSource(ctx: ExtensionContext): UsageSource {
  return {
    async load(signal): Promise<UsageSnapshot | undefined> {
      const auth = await ctx.modelRegistry.getProviderAuth(PROVIDER_ID);
      const accessToken = auth?.auth.apiKey;
      if (!accessToken) return undefined;

      const accountId = decodeAccountId(accessToken);
      if (!accountId) return undefined;

      const provider = ctx.modelRegistry.getProvider(PROVIDER_ID);
      const baseUrl = (provider?.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
      const response = await fetch(`${baseUrl}${USAGE_PATH}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "ChatGPT-Account-Id": accountId,
          Accept: "application/json",
          "Cache-Control": "no-cache",
          originator: "pi",
          "User-Agent": "pi-everyday",
        },
        signal,
      });
      if (!response.ok) throw new Error(`usage endpoint returned ${response.status}`);
      return parseUsagePayload(await response.json());
    },
  };
}
