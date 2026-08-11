import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { transformLocalFilePaths } from "./transform.ts";

export function registerPathLinks(pi: ExtensionAPI): void {
  let cwd = process.cwd();

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant" || context.isStreaming) return markdown;
    return transformLocalFilePaths(markdown, cwd);
  });
}
