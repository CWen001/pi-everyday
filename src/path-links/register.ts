import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { acquirePathLinkOverlay } from "./overlay.ts";
import { renderPathLinks } from "./transform.ts";

export function registerPathLinks(pi: ExtensionAPI): void {
  const releaseOverlay = acquirePathLinkOverlay();
  let cwd = process.cwd();

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
  });
  pi.on("session_shutdown", releaseOverlay);

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant" || context.isStreaming) return markdown;
    return renderPathLinks({ markdown, cwd });
  });
}
