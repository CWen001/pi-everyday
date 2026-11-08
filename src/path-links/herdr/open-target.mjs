import { spawn } from "node:child_process";
import { win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePath } from "../resolve-folder.mjs";

function validateLocalUri(uri, platform) {
  if (
    typeof uri !== "string" || !/^file:\/\//i.test(uri) ||
    /[\s\u0000-\u001f\u007f-\u009f\\]/u.test(uri) || /%(?![\da-f]{2})/i.test(uri)
  ) {
    throw new TypeError("Expected a complete local file URI");
  }
  const url = new URL(uri);
  if (url.protocol !== "file:" || url.hostname || url.username || url.password || /%(?:2f|5c)/i.test(url.pathname)) {
    throw new TypeError("Expected a local file URI without credentials or encoded separators");
  }
  const path = fileURLToPath(url, { windows: platform === "win32" });
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(path)) {
    throw new TypeError("Control characters are not supported in local paths");
  }
  if (platform === "win32") {
    const parts = path.slice(3).split("\\");
    if (!/^[a-z]:\\/i.test(path) || parts.some((part) =>
      /[<>:"|?*]/u.test(part) || /[. ]$/u.test(part) ||
      /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
    )) {
      throw new TypeError("Expected a native Windows drive path without aliases or device names");
    }
  }
}

export async function openTarget(uri, { platform = process.platform, launch = spawn, env = process.env } = {}) {
  if (platform !== "win32" && platform !== "darwin") {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  validateLocalUri(uri, platform);
  const path = resolvePath(uri, "target");
  let command = "/usr/bin/open";
  if (platform === "win32") {
    if (!env.SystemRoot || !/^[a-z]:\\/i.test(env.SystemRoot)) {
      throw new Error("SystemRoot must be an absolute Windows drive path");
    }
    command = win32.join(env.SystemRoot, "explorer.exe");
  }
  await new Promise((resolve, reject) => {
    const child = launch(command, [path], { shell: false, windowsHide: false, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { path, accepted: true };
}

if (import.meta.main) {
  try {
    if (process.argv.length > 3) throw new Error("Expected one file URI, without an opening intent");
    const uri = process.argv[2] ?? process.env.HERDR_PLUGIN_CLICKED_URL;
    const result = await openTarget(uri);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
