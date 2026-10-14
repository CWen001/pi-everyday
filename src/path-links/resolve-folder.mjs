import { statSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function resolvePath(uri, intent) {
  if (intent !== "target" && intent !== "folder") {
    throw new TypeError("Expected target or folder intent");
  }
  const path = fileURLToPath(new URL(uri));
  const stats = statSync(path);
  if (stats.isDirectory()) return path;
  if (stats.isFile()) return intent === "folder" ? dirname(path) : path;
  throw new Error(`Path is not a file or directory: ${path}`);
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 4) {
      throw new Error("Expected a complete file URI and target or folder intent");
    }
    const path = resolvePath(process.argv[2], process.argv[3]);
    process.stdout.write(`${JSON.stringify({ path })}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
