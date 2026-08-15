import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const INLINE_CODE_RE = /`([^`\n]+)`/g;
const MARKDOWN_LINK_RE = /(!?)\[([^\]]+)\]\(([^)\s]+)\)/g;
const FENCED_BLOCK_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

function resolveLocalTarget(value: string, cwd: string): string | undefined {
  const candidate = value.trim();
  if (!candidate || candidate.includes("://") || candidate.includes("\n")) return undefined;
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

  const expanded = candidate.startsWith("~/")
    ? resolve(homedir(), candidate.slice(2))
    : candidate;
  const absolutePath = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);

  try {
    if (!existsSync(absolutePath)) return undefined;
    const stat = statSync(absolutePath);
    return stat.isDirectory() ? absolutePath : stat.isFile() ? dirname(absolutePath) : undefined;
  } catch {
    return undefined;
  }
}

function linkMarkdownFiles(markdown: string, cwd: string): string {
  return markdown.replace(
    MARKDOWN_LINK_RE,
    (full, imagePrefix: string, label: string, target: string) => {
      if (imagePrefix) return full;
      const targetPath = resolveLocalTarget(target, cwd);
      return targetPath ? `[${label}](${pathToFileURL(targetPath).href})` : full;
    },
  );
}

function linkInlineFiles(markdown: string, cwd: string): string {
  return markdown.replace(INLINE_CODE_RE, (full, candidate: string, offset: number, source: string) => {
    const before = source.slice(0, offset);
    const after = source.slice(offset + full.length);
    if (before.endsWith("[") && after.startsWith("](")) return full;

    const targetPath = resolveLocalTarget(candidate, cwd);
    if (!targetPath) return full;
    return `[\`${candidate}\`](${pathToFileURL(targetPath).href})`;
  });
}

function linkStandaloneFiles(markdown: string, cwd: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*(?:[-*]\s+)?)(\S+)(\s*)$/u);
      if (!match || match[2]?.startsWith("[") || match[2]?.includes("://")) return line;

      const targetPath = resolveLocalTarget(match[2] ?? "", cwd);
      if (!targetPath) return line;
      return `${match[1]}[${match[2]}](${pathToFileURL(targetPath).href})${match[3]}`;
    })
    .join("\n");
}

function linkTextPathListFences(markdown: string, cwd: string): string {
  return markdown.replace(FENCED_BLOCK_RE, (fence) => {
    const lines = fence.split("\n");
    const opening = /^ {0,3}(```|~~~)\s*text\s*$/iu.exec(lines[0] ?? "");
    if (!opening || lines.at(-1)?.trim() !== opening[1]) return fence;

    const body = lines.slice(1, -1);
    let linkedPathCount = 0;
    const linkedBody = body.map((line) => {
      if (!line.trim()) return line;
      const linked = linkStandaloneFiles(line, cwd);
      if (linked === line) return undefined;
      linkedPathCount++;
      return linked;
    });

    if (linkedPathCount === 0 || linkedBody.some((line) => line === undefined)) return fence;
    return linkedBody.join("\n");
  });
}

export function transformLocalFilePaths(markdown: string, cwd: string): string {
  return linkTextPathListFences(markdown, cwd)
    .split(FENCED_BLOCK_RE)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : linkStandaloneFiles(linkInlineFiles(linkMarkdownFiles(part, cwd), cwd), cwd),
    )
    .join("");
}
