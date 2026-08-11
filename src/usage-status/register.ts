import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatUsageStatus } from "./format.ts";
import { createOpenAIUsageSource } from "./openai-source.ts";
import type { UsageSource } from "./types.ts";

const STATUS_KEY = "pi-everyday-usage";
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;

interface UsageRegistrationOptions {
  now?: () => number;
  sourceFactory?: (ctx: ExtensionContext) => UsageSource;
}

export function registerUsageStatus(
  pi: ExtensionAPI,
  options: UsageRegistrationOptions = {},
): void {
  const now = options.now ?? Date.now;
  const sourceFactory = options.sourceFactory ?? createOpenAIUsageSource;
  let active = false;
  let source: UsageSource | undefined;
  let inFlight: Promise<void> | undefined;
  let abortController: AbortController | undefined;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let lastStatus: string | undefined;

  const publish = (ctx: ExtensionContext, status: string | undefined): void => {
    if (!active || !ctx.hasUI) return;
    lastStatus = status;
    ctx.ui.setStatus(
      STATUS_KEY,
      status ? ctx.ui.theme.fg("dim", status) : undefined,
    );
  };

  const refresh = async (ctx: ExtensionContext, force = false): Promise<void> => {
    if (!active || !ctx.hasUI || !source) return;
    const attemptedAt = now();
    if (!force && attemptedAt - lastAttemptAt < REFRESH_COOLDOWN_MS) return;
    if (inFlight) return inFlight;
    lastAttemptAt = attemptedAt;

    inFlight = (async () => {
      abortController = new AbortController();
      const timeout = setTimeout(() => abortController?.abort(), REQUEST_TIMEOUT_MS);
      try {
        const snapshot = await source?.load(abortController.signal);
        if (!snapshot) {
          publish(ctx, undefined);
          return;
        }
        publish(ctx, formatUsageStatus(snapshot));
      } catch {
        // Keep the last successful status and remain silent on optional-network failure.
        if (lastStatus) publish(ctx, lastStatus);
      } finally {
        clearTimeout(timeout);
        abortController = undefined;
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    active = true;
    source = sourceFactory(ctx);
    lastAttemptAt = Number.NEGATIVE_INFINITY;
    await refresh(ctx, true);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await refresh(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    active = false;
    abortController?.abort();
    source = undefined;
    inFlight = undefined;
    lastStatus = undefined;
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
