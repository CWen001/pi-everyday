import { renderPathLinks } from "./transform.ts";

type SessionStartHandler = (event: unknown, context: { cwd: string }) => void;
type AssistantTextTransformer = (markdown: string, context: { isStreaming: boolean }) => string;

interface OmpPathLinkHost {
  on(event: "session_start", handler: SessionStartHandler): void;
  registerAssistantTextTransformer(transformer: AssistantTextTransformer): void;
}

function requireOmpPathLinkHost(value: unknown): OmpPathLinkHost {
  if (
    !value ||
    typeof value !== "object" ||
    !("on" in value) ||
    typeof value.on !== "function" ||
    !("registerAssistantTextTransformer" in value) ||
    typeof value.registerAssistantTextTransformer !== "function"
  ) {
    throw new Error(
      "pi-everyday path links require OMP display-only assistant text transformers; message_end snapshots are unsupported",
    );
  }
  return value as OmpPathLinkHost;
}

/** Register path links at OMP's display-only assistant Markdown seam. */
export function registerOmpPathLinks(api: unknown): void {
  const omp = requireOmpPathLinkHost(api);
  let cwd = process.cwd();

  omp.on("session_start", (_event, context) => {
    cwd = context.cwd;
  });

  omp.registerAssistantTextTransformer((markdown) => renderPathLinks({ markdown, cwd }));
}
