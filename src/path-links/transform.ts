import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const INLINE_CODE_RE = /`([^`\n]+)`/g;
const MARKDOWN_LINK_RE = /(!?)\[([^\]]+)\]\(([^)\s]+)\)/g;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/u;

type ResolveTarget = (candidate: string) => string | undefined;

export interface FinalAssistantMarkdown {
  readonly markdown: string;
  /** Absolute working directory of the session being rendered. */
  readonly cwd: string;
}

export class PathLinkInputError extends Error {}

export class PathLinkTransformError extends Error {
  readonly candidate: string;

  constructor(candidate: string, options: ErrorOptions) {
    super(`Unable to inspect local path: ${candidate}`, options);
    this.candidate = candidate;
  }
}

function isMissingPathError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

function createTargetResolver(cwd: string): ResolveTarget {
  const cache = new Map<string, string | undefined>();

  return (value) => {
    const candidate = value.trim();
    if (!candidate || candidate.includes("://") || candidate.includes("\n") || candidate.includes("\0")) {
      return undefined;
    }
    if (
      !isAbsolute(candidate) &&
      !candidate.startsWith("~/") &&
      !candidate.startsWith("./") &&
      !candidate.startsWith("../") &&
      !candidate.includes("/") &&
      !candidate.includes("\\")
    ) {
      return undefined;
    }
    if (cache.has(candidate)) return cache.get(candidate);

    const expanded = candidate.startsWith("~/") ? resolve(homedir(), candidate.slice(2)) : candidate;
    const absolutePath = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);

    try {
      const stat = statSync(absolutePath);
      const target = stat.isDirectory() ? absolutePath : stat.isFile() ? dirname(absolutePath) : undefined;
      cache.set(candidate, target);
      return target;
    } catch (error) {
      if (isMissingPathError(error)) {
        cache.set(candidate, undefined);
        return undefined;
      }
      throw new PathLinkTransformError(candidate, { cause: error });
    }
  };
}

function linkMarkdownTargets(markdown: string, resolveTarget: ResolveTarget): string {
  return markdown.replace(
    MARKDOWN_LINK_RE,
    (full, imagePrefix: string, label: string, target: string) => {
      if (imagePrefix) return full;
      const targetPath = resolveTarget(target);
      return targetPath ? `[${label}](${pathToFileURL(targetPath).href})` : full;
    },
  );
}

function linkInlineCode(markdown: string, resolveTarget: ResolveTarget): string {
  return markdown.replace(INLINE_CODE_RE, (full, candidate: string, offset: number, source: string) => {
    const before = source.slice(0, offset);
    const after = source.slice(offset + full.length);
    if (before.endsWith("[") && after.startsWith("](")) return full;

    const targetPath = resolveTarget(candidate);
    return targetPath ? `[\`${candidate}\`](${pathToFileURL(targetPath).href})` : full;
  });
}

function linkStandaloneLines(markdown: string, resolveTarget: ResolveTarget): string {
  return markdown
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*(?:[-*]\s+)?)(\S+)(\s*)$/u);
      if (!match || match[2]?.startsWith("[") || match[2]?.includes("://")) return line;

      const targetPath = resolveTarget(match[2] ?? "");
      return targetPath ? `${match[1]}[${match[2]}](${pathToFileURL(targetPath).href})${match[3]}` : line;
    })
    .join("\n");
}

function transformOrdinaryMarkdown(markdown: string, resolveTarget: ResolveTarget): string {
  return linkStandaloneLines(linkInlineCode(linkMarkdownTargets(markdown, resolveTarget), resolveTarget), resolveTarget);
}

function closingFenceMatches(line: string, opening: string): boolean {
  const marker = opening[0];
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
  return Boolean(match && match[1]?.[0] === marker && match[1].length >= opening.length);
}

function transformTextFence(
  bodyLines: string[],
  closingHasNewline: boolean,
  resolveTarget: ResolveTarget,
): string | undefined {
  let linkedCount = 0;
  const linkedLines: string[] = [];

  for (const rawLine of bodyLines) {
    const hasNewline = rawLine.endsWith("\n");
    const line = hasNewline ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) {
      linkedLines.push(rawLine);
      continue;
    }

    const linked = linkStandaloneLines(line, resolveTarget);
    if (linked === line) return undefined;
    linkedCount++;
    linkedLines.push(linked + (hasNewline ? "\n" : ""));
  }

  if (linkedCount === 0) return undefined;
  let result = linkedLines.join("");
  if (result.endsWith("\n")) result = result.slice(0, -1);
  return result + (closingHasNewline ? "\n" : "");
}

function transformFencedMarkdown(markdown: string, resolveTarget: ResolveTarget): string {
  const lines = markdown.match(/[^\n]*(?:\n|$)/gu)?.filter((line) => line.length > 0) ?? [];
  const output: string[] = [];
  let ordinaryStart = 0;

  for (let index = 0; index < lines.length; index++) {
    const openingLine = lines[index] ?? "";
    const openingText = openingLine.endsWith("\n") ? openingLine.slice(0, -1) : openingLine;
    const opening = FENCE_OPEN_RE.exec(openingText);
    if (!opening?.[1]) continue;

    let closingIndex = index + 1;
    while (closingIndex < lines.length) {
      const rawClosing = lines[closingIndex] ?? "";
      const closingText = rawClosing.endsWith("\n") ? rawClosing.slice(0, -1) : rawClosing;
      if (closingFenceMatches(closingText, opening[1])) break;
      closingIndex++;
    }
    if (closingIndex >= lines.length) continue;

    output.push(transformOrdinaryMarkdown(lines.slice(ordinaryStart, index).join(""), resolveTarget));
    const fence = lines.slice(index, closingIndex + 1).join("");
    const info = opening[2]?.trim().toLowerCase();
    const closingLine = lines[closingIndex] ?? "";
    const linkedFence =
      info === "text"
        ? transformTextFence(lines.slice(index + 1, closingIndex), closingLine.endsWith("\n"), resolveTarget)
        : undefined;
    output.push(linkedFence ?? fence);

    index = closingIndex;
    ordinaryStart = closingIndex + 1;
  }

  output.push(transformOrdinaryMarkdown(lines.slice(ordinaryStart).join(""), resolveTarget));
  return output.join("");
}

/** Produce display Markdown with clickable links for existing local paths. */
export function renderPathLinks(input: FinalAssistantMarkdown): string {
  if (!isAbsolute(input.cwd)) {
    throw new PathLinkInputError("Path-link rendering requires an absolute session cwd");
  }
  if (!input.markdown) return input.markdown;
  return transformFencedMarkdown(input.markdown, createTargetResolver(input.cwd));
}
