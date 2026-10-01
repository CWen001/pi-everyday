import { statSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveFolder(uri) {
  const path = fileURLToPath(new URL(uri));
  const stats = statSync(path);
  if (stats.isDirectory()) return path;
  if (stats.isFile()) return dirname(path);
  throw new Error(`Path is not a file or directory: ${path}`);
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 3) {
      throw new Error("Expected one complete file URI argument");
    }
    const folder = resolveFolder(process.argv[2]);
    process.stdout.write(`${JSON.stringify({ folder })}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
