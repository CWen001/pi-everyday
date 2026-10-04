import type { UsageSource } from "./types.ts";

export function createOpenAIUsageSource(): UsageSource {
  return {
    async load(signal) {
      signal.throwIfAborted();
      // Current ChatGPT OAuth targets api.openai.com, with opaque account metadata.
      // No supported quota endpoint is established: stay unavailable without reading
      // credentials or falling back to legacy WHAM. See docs/research/openai-usage-contract.md.
      return undefined;
    },
  };
}
