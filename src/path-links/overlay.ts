import { Markdown, type MarkdownOptions } from "@earendil-works/pi-tui";
import { renderAbsolutePathLinks } from "./transform.ts";

const OVERLAY = Symbol.for("pi-everyday.path-links.markdown-overlay");

type MarkdownRender = typeof Markdown.prototype.render;
type OverlayState = {
  originalRender: MarkdownRender;
  owners: Set<symbol>;
};
type OverlayPrototype = typeof Markdown.prototype & { [OVERLAY]?: unknown };
type MarkdownInternals = {
  invalidate?: unknown;
  options?: unknown;
};

function isOverlayState(value: unknown): value is OverlayState {
  return Boolean(
    value &&
      typeof value === "object" &&
      "originalRender" in value &&
      typeof value.originalRender === "function" &&
      "owners" in value &&
      value.owners instanceof Set,
  );
}

function installPathLinkOverlay(): OverlayState | undefined {
  const prototype = Markdown.prototype as OverlayPrototype;
  if (isOverlayState(prototype[OVERLAY])) return prototype[OVERLAY];
  if (prototype[OVERLAY] !== undefined || typeof prototype.render !== "function") return undefined;

  const state: OverlayState = { originalRender: prototype.render, owners: new Set() };
  const renderModes = new WeakMap<object, boolean>();
  try {
    prototype[OVERLAY] = state;
    prototype.render = function renderWithPathLinks(width: number): string[] {
      const active = state.owners.size > 0;
      const internals = this as unknown as MarkdownInternals;
      const previousMode = renderModes.get(this);
      if (previousMode !== active) {
        if (previousMode !== undefined || active) {
          if (typeof internals.invalidate !== "function") {
            return state.originalRender.call(this, width);
          }
          try {
            internals.invalidate.call(this);
          } catch {
            return state.originalRender.call(this, width);
          }
        }
        renderModes.set(this, active);
      }
      if (!active) return state.originalRender.call(this, width);

      const options = internals.options;
      if (!options || typeof options !== "object" || Array.isArray(options)) {
        return state.originalRender.call(this, width);
      }

      const markdownOptions = options as MarkdownOptions;
      const previous = markdownOptions.transform;
      if (previous !== undefined && typeof previous !== "function") {
        return state.originalRender.call(this, width);
      }

      const transform: NonNullable<MarkdownOptions["transform"]> = (markdown, availableWidth) => {
        const transformed = previous?.(markdown, availableWidth) ?? markdown;
        try {
          return renderAbsolutePathLinks(transformed);
        } catch {
          return transformed;
        }
      };

      try {
        markdownOptions.transform = transform;
      } catch {
        return state.originalRender.call(this, width);
      }
      if (markdownOptions.transform !== transform) return state.originalRender.call(this, width);

      try {
        return state.originalRender.call(this, width);
      } finally {
        try {
          markdownOptions.transform = previous;
        } catch {
          // A renderer that freezes its private options must still retain its rendered output.
        }
      }
    };
  } catch {
    if (prototype[OVERLAY] === state) delete prototype[OVERLAY];
    return undefined;
  }
  return state;
}

/** Acquire this extension instance's ownership of the shared host Markdown overlay. */
export function acquirePathLinkOverlay(): () => void {
  const overlay = installPathLinkOverlay();
  const owner = Symbol("pi-everyday.path-links.owner");
  overlay?.owners.add(owner);
  return () => overlay?.owners.delete(owner);
}
