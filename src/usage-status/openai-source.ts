import childProcess from "node:child_process";
import { tmpdir } from "node:os";
import type { UsageSnapshot, UsageSource, UsageWindow } from "./types.ts";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseWindow(value: unknown): UsageWindow | undefined {
  const window = record(value);
  if (!window || !finite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100 ||
      !finite(window.windowDurationMins) || window.windowDurationMins <= 0) return undefined;
  return {
    usedPercent: window.usedPercent,
    remainingPercent: 100 - window.usedPercent,
    windowSeconds: window.windowDurationMins * 60,
    resetAfterSeconds: finite(window.resetsAt) ? Math.max(0, window.resetsAt - Date.now() / 1000) : undefined,
  };
}

function parseUsage(value: unknown): UsageSnapshot | undefined {
  const result = record(value);
  const limit = record(record(result?.rateLimitsByLimitId)?.codex ?? result?.rateLimits);
  if (!limit || (limit.limitId != null && limit.limitId !== "codex")) return undefined;
  const primary = parseWindow(limit.primary), secondary = parseWindow(limit.secondary);
  return primary || secondary ? { rateLimit: { primary, secondary }, additionalRateLimits: [] } : undefined;
}

export function createOpenAIUsageSource(): UsageSource {
  return {
    async load(signal) {
      signal.throwIfAborted();
      // Codex owns authentication. Only read quota; never start a thread or copy tokens.
      return new Promise<UsageSnapshot | undefined>((resolve) => {
        const child = childProcess.spawn("codex", ["app-server"], {
          cwd: tmpdir(), stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
        });
        let done = false, initialized = false, buffer = "", bytes = 0;
        let hardStop: ReturnType<typeof setTimeout> | undefined;
        const finish = (snapshot?: UsageSnapshot) => {
          if (done) return;
          done = true;
          signal.removeEventListener("abort", cancel);
          child.stdin.destroy();
          child.stdout.destroy();
          child.kill();
          hardStop = setTimeout(() => child.kill("SIGKILL"), 500);
          hardStop.unref();
          resolve(snapshot);
        };
        const cancel = () => finish();
        const send = (message: object) => child.stdin.write(JSON.stringify(message) + "\n");
        child.on("error", cancel);
        child.stdin.on("error", cancel);
        child.stdout.on("error", cancel);
        child.on("close", () => { finish(); clearTimeout(hardStop); });
        signal.addEventListener("abort", cancel, { once: true });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          if (done) return;
          bytes += Buffer.byteLength(chunk);
          if (bytes > 1024 * 1024) { finish(); return; }
          buffer += chunk;
          let end: number;
          while (!done && (end = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            try {
              const message = record(JSON.parse(line));
              if (message?.id === 1 && !initialized) {
                if (message.error || !record(message.result)) { finish(); return; }
                initialized = true;
                send({ method: "initialized", params: {} });
                send({ method: "account/rateLimits/read", id: 2 });
              } else if (message?.id === 2 && initialized) {
                finish(message.error ? undefined : parseUsage(message.result));
              }
            } catch { finish(); }
          }
        });
        send({ method: "initialize", id: 1, params: {
          clientInfo: { name: "pi_everyday_usage", version: "0.4.0" },
        } });
      });
    },
  };
}
