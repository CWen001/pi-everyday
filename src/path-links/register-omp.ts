import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { transformLocalFilePaths } from "./transform.ts";

/** Register path links through OMP's settled-message event API. */
export function registerOmpPathLinks(pi: ExtensionAPI): void {
  let cwd = process.cwd();

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;

    for (const content of event.message.content) {
      if (content.type !== "text") continue;
      content.text = transformLocalFilePaths(content.text, cwd);
    }
  });
}
