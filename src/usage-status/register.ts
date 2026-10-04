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
  const now = options.now ?? (() => performance.now());
  const sourceFactory = options.sourceFactory ?? createOpenAIUsageSource;
  let active = false;
  let source: UsageSource | undefined;
  let abortController: AbortController | undefined;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;

  const publish = (ctx: ExtensionContext, status: string | undefined): void => {
    if (!active || !ctx.hasUI) return;
    ctx.ui.setStatus(
      STATUS_KEY,
      status ? ctx.ui.theme.fg("dim", status) : undefined,
    );
  };

  const refresh = (ctx: ExtensionContext, force = false): void => {
    if (!active || !ctx.hasUI || !source || abortController) return;
    const attemptedAt = now();
    if (!force && attemptedAt - lastAttemptAt < REFRESH_COOLDOWN_MS) return;
    lastAttemptAt = attemptedAt;
    const deadline = attemptedAt + REQUEST_TIMEOUT_MS;

    const controller = new AbortController();
    abortController = controller;
    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const currentSource = source;
    void (async () => {
      try {
        const snapshot = await Promise.race([currentSource.load(controller.signal), aborted]);
        if (abortController === controller) {
          publish(ctx, !controller.signal.aborted && now() < deadline && snapshot ? formatUsageStatus(snapshot) : undefined);
        }
      } catch {
        if (abortController === controller) publish(ctx, undefined);
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", onAbort);
        if (abortController === controller) abortController = undefined;
      }
    })();
  };

  pi.on("session_start", (_event, ctx) => {
    active = false;
    abortController?.abort();
    abortController = undefined;
    source = undefined;
    if (!ctx.hasUI) return;
    active = true;
    publish(ctx, undefined);
    source = sourceFactory(ctx);
    lastAttemptAt = Number.NEGATIVE_INFINITY;
    void refresh(ctx, true);
  });

  pi.on("turn_end", (_event, ctx) => {
    void refresh(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    active = false;
    abortController?.abort();
    source = undefined;
    abortController = undefined;
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
