import childProcess from "node:child_process";
import { tmpdir } from "node:os";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, isAbsolute } from "node:path";
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

function codexLaunch() {
  const fallback = { command: "codex", env: process.env };
  if (process.platform !== "win32") return fallback;
  const target = process.arch === "x64" ? "x86_64-pc-windows-msvc" :
    process.arch === "arm64" ? "aarch64-pc-windows-msvc" : undefined;
  for (const entry of (process.env.PATH ?? "").split(";")) {
    const directory = entry.replace(/^"|"$/g, "");
    if (!isAbsolute(directory)) continue;
    const native = join(directory, "codex.exe");
    if (existsSync(native)) return { command: realpathSync(native), env: process.env };
    const manifest = join(directory, "node_modules", "@openai", "codex", "package.json");
    if (!target || !existsSync(join(directory, "codex.cmd")) || !existsSync(manifest)) continue;
    const packageRoot = dirname(realpathSync(manifest));
    let vendor = join(packageRoot, "vendor");
    try {
      vendor = join(dirname(createRequire(manifest).resolve(`@openai/codex-win32-${process.arch}/package.json`)), "vendor");
    } catch {
      // Older Codex npm versions ship the native binary inside the main package.
    }
    const executable = join(vendor, target, "bin", "codex.exe");
    if (!existsSync(executable)) continue;
    const env = { ...process.env };
    for (const manager of ["NPM", "BUN", "PNPM", "VITE_PLUS"]) delete env[`CODEX_MANAGED_BY_${manager}`];
    env.CODEX_MANAGED_BY_NPM = "1";
    env.CODEX_MANAGED_PACKAGE_ROOT = packageRoot;
    return { command: realpathSync(executable), env };
  }
  return fallback;
}

export function createOpenAIUsageSource(): UsageSource {
  return {
    async load(signal) {
      signal.throwIfAborted();
      // Codex owns authentication. Only read quota; never start a thread or copy tokens.
      const launch = codexLaunch();
      return new Promise<UsageSnapshot | undefined>((resolve) => {
        const child = childProcess.spawn(launch.command, ["app-server"], {
          cwd: tmpdir(), stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: launch.env,
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
