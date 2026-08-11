import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const INLINE_CODE_RE = /`([^`\n]+)`/g;
const FENCED_BLOCK_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

function resolveLocalFile(value: string, cwd: string): string | undefined {
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
    return existsSync(absolutePath) && statSync(absolutePath).isFile() ? absolutePath : undefined;
  } catch {
    return undefined;
  }
}

function linkInlineFiles(markdown: string, cwd: string): string {
  return markdown.replace(INLINE_CODE_RE, (full, candidate: string, offset: number, source: string) => {
    const before = source.slice(0, offset);
    const after = source.slice(offset + full.length);
    if (before.endsWith("[") && after.startsWith("](")) return full;

    const filePath = resolveLocalFile(candidate, cwd);
    if (!filePath) return full;
    return `[\`${candidate}\`](${pathToFileURL(dirname(filePath)).href})`;
  });
}

function linkStandaloneFiles(markdown: string, cwd: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*(?:[-*]\s+)?)(\S+)(\s*)$/u);
      if (!match || match[2]?.startsWith("[") || match[2]?.includes("://")) return line;

      const filePath = resolveLocalFile(match[2] ?? "", cwd);
      if (!filePath) return line;
      return `${match[1]}[${match[2]}](${pathToFileURL(dirname(filePath)).href})${match[3]}`;
    })
    .join("\n");
}

export function transformLocalFilePaths(markdown: string, cwd: string): string {
  return markdown
    .split(FENCED_BLOCK_RE)
    .map((part, index) =>
      index % 2 === 1 ? part : linkStandaloneFiles(linkInlineFiles(part, cwd), cwd),
    )
    .join("");
}
