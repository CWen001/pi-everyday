import assert from "node:assert/strict";
import test from "node:test";
import { auditRollout } from "../skills/codex-image-gen/scripts/rollout.mjs";
import { imageBase64 } from "./fixtures/image.mjs";
const threadId = "thread-1";
const metadata = { type: "session_meta", payload: { id: threadId, session_id: threadId } };
const begin = { type: "event_msg", payload: { type: "image_generation_begin", call_id: "image-1" } };
const ending = { type: "event_msg", payload: { type: "image_generation_end", call_id: "image-1", status: "completed", saved_path: "/generated/image.png" } };
const extension = { type: "event_msg", payload: { type: "item_completed", thread_id: threadId,
  item: { type: "Extension", kind: "image_gen.generation", id: "image-1", status: "completed", savedPath: "/generated/image.png" } } };

test("legacy and Extension completions identify one image, not two submissions", () => {
  for (const completions of [[ending], [extension], [ending, extension, ending]]) {
    const result = auditRollout([metadata, begin, ...completions], threadId);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.submissions, 1);
    assert.equal(result.check.status, "verified");
    assert.equal(result.pending, false);
  }
});

test("valid image evidence survives unknown events and fields with an incomplete check", () => {
  const result = auditRollout([metadata, begin, ending, extension,
    { type: "event_msg", payload: { type: "future_event" } }], threadId);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.check.status, "incomplete");
  const newField = auditRollout([metadata, { ...ending, payload: { ...ending.payload, futureField: true } }], threadId);
  assert.equal(newField.artifacts.length, 1);
  assert.equal(newField.check.status, "incomplete");
});

test("exec code shapes are opaque evidence, never evaluated or treated as proof of isolation", () => {
  for (const input of [
    "const r = await tools.image_gen__imagegen({transparent_background:true, prompt:'kite'}); generatedImage(r)",
    "await arbitraryJavascript()", "throw new Error('must never be executed')",
    "const r = await tools.image_gen__imagegen({prompt:`multiline\nkite`, referenced_image_paths:['a','b']})",
  ]) {
    const result = auditRollout([metadata,
      { type: "response_item", payload: { type: "custom_tool_call", name: "exec", input } }, ending], threadId);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.check.status, "incomplete");
  }
});

test("view_image and repeated waits are supporting actions, not extra generations", () => {
  const result = auditRollout([metadata, begin,
    ...["view_image", "wait", "wait"].map((name) => ({ type: "response_item", payload: { type: "function_call", name } })), ending], threadId);
  assert.equal(result.submissions, 1);
  assert.equal(result.check.status, "verified");
});

test("known unauthorized execution does not discard already generated images", () => {
  const result = auditRollout([metadata, ending,
    { type: "response_item", payload: { type: "function_call", name: "apply_patch" } }], threadId);
  assert.equal(result.check.status, "violation");
  assert.equal(result.artifacts.length, 1);
});

test("missing, cross-session and conflicting artifact identities are rejected", () => {
  for (const events of [
    [ending],
    [metadata, { ...extension, payload: { ...extension.payload, thread_id: "other" } }],
    [metadata, { ...ending, payload: { ...ending.payload, call_id: null } }],
    [metadata, ending, { ...extension, payload: { ...extension.payload, item: { ...extension.payload.item, savedPath: "/other.png" } } }],
  ]) assert.throws(() => auditRollout(events, threadId));
});

test("pending, failed and multiple generations have independent identities", () => {
  assert.equal(auditRollout([metadata, begin], threadId).pending, true);
  const failed = { ...ending, payload: { ...ending.payload, status: "failed", failure: { code: "server_error" } } };
  const result = auditRollout([metadata, begin, failed,
    { ...ending, payload: { ...ending.payload, call_id: "image-2" } }], threadId);
  assert.equal(result.submissions, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.artifacts.length, 1);
});

test("native inline image data is preserved for recovery without a saved path", () => {
  for (const event of [
    { ...ending, payload: { ...ending.payload, saved_path: null, result: imageBase64 } },
    { ...extension, payload: { ...extension.payload, item: { ...extension.payload.item, savedPath: null, result: imageBase64 } } },
  ]) {
    const result = auditRollout([metadata, event], threadId);
    assert.equal(result.artifacts[0].data, imageBase64);
  }
});
