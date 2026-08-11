export interface UsageWindow {
  usedPercent: number;
  remainingPercent: number;
  windowSeconds?: number;
  resetAfterSeconds?: number;
}

export interface RateLimit {
  limitReached?: boolean;
  primary?: UsageWindow;
  secondary?: UsageWindow;
}

export interface UsageSnapshot {
  rateLimit?: RateLimit;
  additionalRateLimits: Array<{ rateLimit?: RateLimit }>;
}

export interface UsageSource {
  load(signal: AbortSignal): Promise<UsageSnapshot | undefined>;
}
