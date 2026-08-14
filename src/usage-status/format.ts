import type { RateLimit, UsageSnapshot, UsageWindow } from "./types.ts";

function windows(limit: RateLimit | undefined): UsageWindow[] {
  return [limit?.primary, limit?.secondary].filter(
    (window): window is UsageWindow => window !== undefined,
  );
}

function windowLabel(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "?";
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Math.round(seconds)}s`;
}

function remainingTimeLabel(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const parts = [
    [Math.floor(minutes / 1440), "d"],
    [Math.floor((minutes % 1440) / 60), "h"],
    [minutes % 60, "m"],
  ] as const;
  return parts
    .filter(([value]) => value > 0)
    .slice(0, 2)
    .map(([value, unit]) => `${value}${unit}`)
    .join(" ") || "0m";
}

export function formatUsageStatus(snapshot: UsageSnapshot): string | undefined {
  let activeWindows = windows(snapshot.rateLimit);
  if (activeWindows.length === 0) {
    activeWindows = snapshot.additionalRateLimits.flatMap((entry) => windows(entry.rateLimit)).slice(0, 2);
  }
  if (activeWindows.length === 0) return undefined;

  return activeWindows
    .map((window) => {
      const reset = window.resetAfterSeconds;
      return `${windowLabel(window.windowSeconds)} ${Math.round(window.remainingPercent)}% left${
        reset === undefined ? "" : ` (${remainingTimeLabel(reset)})`
      }`;
    })
    .join(" · ");
}
