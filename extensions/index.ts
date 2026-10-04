import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerEditorContext } from "../src/editor-context.ts";
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
    registerEditorContext(pi);
  } catch {
    // Editor integration is optional; keep the rest of Pi available.
  }

  registerPathLinks(pi);
}
