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

export function formatUsageStatus(snapshot: UsageSnapshot): string | undefined {
  let activeWindows = windows(snapshot.rateLimit);
  if (activeWindows.length === 0) {
    activeWindows = snapshot.additionalRateLimits.flatMap((entry) => windows(entry.rateLimit)).slice(0, 2);
  }
  if (activeWindows.length === 0) return undefined;

  return `quota ${activeWindows
    .map((window) => `${Math.round(window.remainingPercent)}%/${windowLabel(window.windowSeconds)}`)
    .join(" ")}`;
}
