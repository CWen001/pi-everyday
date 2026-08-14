import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerImageContextPruning } from "../src/image-context.ts";
import { registerPathLinks } from "../src/path-links/register.ts";
import { registerUsageStatus } from "../src/usage-status/register.ts";

export default function piEveryday(pi: ExtensionAPI): void {
  try {
    registerImageContextPruning(pi);
  } catch {
    // Context hygiene must never prevent Pi from starting.
  }

  try {
    registerUsageStatus(pi);
  } catch {
    // An optional convenience must never prevent Pi from starting.
  }

  try {
    registerPathLinks(pi);
  } catch {
    // Keep each enhancement isolated from the other.
  }
}
