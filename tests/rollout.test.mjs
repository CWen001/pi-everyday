import assert from "node:assert/strict";
import test from "node:test";

import { auditRollout } from "../skills/codex-image-gen/scripts/rollout.mjs";

const threadId = "thread-1";
const ending = {
  type: "event_msg",
  payload: {
    type: "image_generation_end",
    call_id: "image-1",
    status: "completed",
    saved_path: "/generated/image.png",
  },
};
const metadata = {
  type: "session_meta",
  payload: { id: threadId, session_id: threadId },
};

function legacyEvents() {
  return [
    metadata,
    {
      type: "response_item",
      payload: { type: "image_generation_call", id: "image-1", status: "generating" },
    },
    ending,
  ];
}

function customEvents() {
  return [
    metadata,
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        status: "completed",
        call_id: "outer-1",
        input:
          '// @exec: {"yield_time_ms":120000}\nconst result = await tools.image_gen__imagegen({"prompt":"kite"});\ngeneratedImage(result);',
      },
    },
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "outer-1",
        output: "generated",
      },
    },
    ending,
  ];
}

test("auditRollout normalizes the legacy image call format", () => {
  assert.deepEqual(auditRollout(legacyEvents(), threadId), {
    callId: "image-1",
    savedPath: "/generated/image.png",
  });
});

test("auditRollout normalizes the custom-tool image call format", () => {
  assert.deepEqual(auditRollout(customEvents(), threadId), {
    callId: "image-1",
    savedPath: "/generated/image.png",
  });
});

test("auditRollout rejects ambiguous, mismatched, and malformed provenance", () => {
  const cases = [
    ["missing call branch", [metadata, ending]],
    [
      "mixed call branches",
      [...legacyEvents().slice(0, -1), ...customEvents().slice(1)],
    ],
    [
      "mismatched legacy call id",
      legacyEvents().map((event, index) =>
        index === 1 ? { ...event, payload: { ...event.payload, id: "other" } } : event,
      ),
    ],
    [
      "mismatched custom output",
      customEvents().map((event, index) =>
        index === 2
          ? { ...event, payload: { ...event.payload, call_id: "other" } }
          : event,
      ),
    ],
    [
      "computed custom input",
      customEvents().map((event, index) =>
        index === 1
          ? {
              ...event,
              payload: {
                ...event.payload,
                input:
                  '// @exec: {}\nconst result = await tools.image_gen__imagegen({prompt: tools.other()});\ngeneratedImage(result);',
              },
            }
          : event,
      ),
    ],
    ["missing end event", legacyEvents().slice(0, -1)],
    ["duplicate end event", [...legacyEvents(), ending]],
    [
      "failed generation",
      legacyEvents().map((event, index) =>
        index === 2 ? { ...event, payload: { ...event.payload, status: "failed" } } : event,
      ),
    ],
    [
      "missing saved path",
      legacyEvents().map((event, index) =>
        index === 2
          ? { ...event, payload: { ...event.payload, saved_path: "" } }
          : event,
      ),
    ],
    ["wrong session", legacyEvents(), "other-thread"],
    [
      "another tool",
      [
        metadata,
        { type: "response_item", payload: { type: "function_call", name: "exec" } },
        ...legacyEvents().slice(1),
      ],
    ],
    [
      "unknown schema",
      [metadata, { type: "response_item", payload: { type: "future_event" } }, ...legacyEvents().slice(1)],
    ],
    ["malformed event", [metadata, null, ...legacyEvents().slice(1)]],
  ];

  for (const [name, events, id = threadId] of cases) {
    assert.throws(() => auditRollout(events, id), Error, name);
  }
});
