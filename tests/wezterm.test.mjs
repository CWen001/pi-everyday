import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("WezTerm Lua handler preserves input bindings and dispatches explicit intents", (t) => {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const harness = fileURLToPath(new URL("./wezterm.test.lua", import.meta.url));
  const candidates = [
    ["lua5.4", [harness]],
    ["lua", [harness]],
    ["wezterm", ["--config-file", harness, "show-keys"]],
  ];
  if (process.platform === "darwin") {
    candidates.push(["/Applications/WezTerm.app/Contents/MacOS/wezterm", ["--config-file", harness, "show-keys"]]);
  }
  for (const [program, args] of candidates) {
    const result = spawnSync(program, args, { cwd, encoding: "utf8", timeout: 30_000 });
    if (result.error?.code === "ENOENT") continue;
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /wezterm path-links checks passed/);
    return;
  }
  t.skip("Lua and WezTerm unavailable; Lua handler checks require either executable");
});
