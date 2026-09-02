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

function itemCompletedEvents() {
  return [
    metadata,
    ...customEvents().slice(1, -1),
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        thread_id: threadId,
        turn_id: "turn-1",
        item: {
          type: "Extension",
          kind: "image_gen.generation",
          id: "exec-1",
          status: "completed",
          savedPath: "/generated/image.png",
          failure: null,
        },
      },
    },
  ];
}

function asyncImageEvents() {
  const events = itemCompletedEvents();
  events[1].payload.input =
    "const r = await tools.image_gen__imagegen({num_last_images_to_include:1,prompt:`kite`});\ngeneratedImage(r);";
  events[2].payload.output = "Script running with cell ID 1\n";
  events.splice(-1, 0,
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "wait",
        call_id: "wait-1",
        arguments: '{"cell_id":"1","yield_time_ms":120000,"max_tokens":2000}',
      },
    },
    {
      type: "response_item",
      payload: { type: "function_call_output", call_id: "wait-1", output: "generated" },
    },
  );
  return events;
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

test("auditRollout normalizes Codex item_completed image generation", () => {
  assert.deepEqual(auditRollout(itemCompletedEvents(), threadId), {
    callId: "exec-1",
    savedPath: "/generated/image.png",
  });
});

test("auditRollout normalizes current asynchronous image generation", () => {
  assert.deepEqual(auditRollout(asyncImageEvents(), threadId), {
    callId: "exec-1",
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
      "item_completed with another custom tool",
      [
        metadata,
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "exec",
            status: "completed",
            call_id: "patch-1",
            input: "const result = await tools.apply_patch(\"*** Begin Patch\\n*** End Patch\");",
          },
        },
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call_output",
            call_id: "patch-1",
            output: "done",
          },
        },
        ...itemCompletedEvents().slice(1),
      ],
    ],
    [
      "wrong completed-item thread",
      itemCompletedEvents().map((event) =>
        event.payload?.type === "item_completed"
          ? { ...event, payload: { ...event.payload, thread_id: "other-thread" } }
          : event,
      ),
    ],
    [
      "unknown completed extension",
      itemCompletedEvents().map((event) =>
        event.payload?.type === "item_completed"
          ? {
              ...event,
              payload: {
                ...event.payload,
                item: { ...event.payload.item, kind: "other.extension" },
              },
            }
          : event,
      ),
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
