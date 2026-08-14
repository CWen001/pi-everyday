import assert from "node:assert/strict";
import test from "node:test";
import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import { pruneHistoricalImages } from "../src/image-context.ts";

type Messages = ContextEvent["messages"];
type Assistant = Extract<Messages[number], { role: "assistant" }>;

const image = (data: string) => ({ type: "image" as const, data, mimeType: "image/png" });
const assistant = (
  content: Assistant["content"],
  timestamp: number,
  stopReason: Assistant["stopReason"] = "stop",
): Assistant => ({
  role: "assistant",
  content,
  api: "openai-responses",
  provider: "test",
  model: "test",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason,
  timestamp,
});
const omittedImage = {
  type: "text" as const,
  text: "[image omitted from active context; re-read its original path or ask the user to reattach it]",
};

test("keeps every image in the current turn", () => {
  const messages: Messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "Compare all references" },
        image("one"),
        image("two"),
      ],
      timestamp: 1,
    },
  ];

  assert.deepEqual(pruneHistoricalImages(messages), messages);
});

test("replaces historical images without changing surrounding content", () => {
  const messages: Messages = [
    {
      role: "user",
      content: [{ type: "text", text: "Pine reference" }, image("pine")],
      timestamp: 1,
    },
    assistant([{ type: "text", text: "I reviewed the pine reference." }], 2),
    { role: "user", content: "Look again", timestamp: 3 },
  ];

  const original = structuredClone(messages);
  assert.deepEqual(pruneHistoricalImages(messages), [
    {
      ...messages[0],
      content: [
        { type: "text", text: "Pine reference" },
        omittedImage,
      ],
    },
    messages[1],
    messages[2],
  ]);
  assert.deepEqual(messages, original);
});

test("prunes historical tool and custom images but keeps current tool images", () => {
  const messages: Messages = [
    { role: "user", content: "Inspect", timestamp: 1 },
    assistant(
      [{ type: "toolCall", id: "old-call", name: "read", arguments: { path: "old" } }],
      2,
      "toolUse",
    ),
    {
      role: "toolResult",
      toolCallId: "old-call",
      toolName: "read",
      content: [{ type: "text", text: "old path" }, image("old-tool")],
      isError: false,
      timestamp: 3,
    },
    {
      role: "custom",
      customType: "screenshot",
      content: [image("old-custom")],
      display: true,
      timestamp: 4,
    },
    { role: "user", content: "Continue", timestamp: 5 },
    {
      role: "toolResult",
      toolCallId: "current-call",
      toolName: "read",
      content: [image("current-tool")],
      isError: false,
      timestamp: 6,
    },
  ];

  const original = structuredClone(messages);
  const result = pruneHistoricalImages(messages);
  assert.strictEqual(result[1], messages[1]);
  assert.deepEqual(result[2], {
    ...messages[2],
    content: [{ type: "text", text: "old path" }, omittedImage],
  });
  assert.deepEqual(result[3], { ...messages[3], content: [omittedImage] });
  assert.strictEqual(result[5], messages[5]);
  assert.deepEqual(messages, original);
});

test("preserves unknown messages and malformed image blocks", () => {
  const messages = [
    null,
    { role: "future", content: [image("valid-but-unknown")], timestamp: 1 },
    {
      role: "custom",
      customType: "malformed",
      content: [{ type: "image" }],
      display: true,
      timestamp: 2,
    },
    { role: "user", content: "Continue", timestamp: 3 },
  ] as unknown as Messages;

  assert.strictEqual(pruneHistoricalImages(messages), messages);
});

test("preserves malformed recognized messages while pruning valid ones", () => {
  const malformed = {
    role: "toolResult",
    content: [image("malformed")],
    timestamp: 2,
  };
  const messages = [
    { role: "user", content: [image("old")], timestamp: 1 },
    malformed,
    { role: "user", content: "Continue", timestamp: 3 },
  ] as unknown as Messages;

  const result = pruneHistoricalImages(messages);
  assert.equal((result[0] as { content: Array<{ type: string }> }).content[0]?.type, "text");
  assert.strictEqual(result[1], malformed);
});

test("ignores malformed user-shaped entries when finding the current turn", () => {
  const messages = [
    { role: "user", content: [image("current")], timestamp: 1 },
    { role: "user", content: null, timestamp: 2 },
  ] as unknown as Messages;

  assert.strictEqual(pruneHistoricalImages(messages), messages);
});

test("preserves image-free context", () => {
  const messages: Messages = [
    { role: "user", content: "First", timestamp: 1 },
    { role: "user", content: "Second", timestamp: 2 },
  ];

  assert.strictEqual(pruneHistoricalImages(messages), messages);
});

test("preserves image context when no user turn exists", () => {
  const messages: Messages = [
    {
      role: "custom",
      customType: "screenshot",
      content: [image("unowned")],
      display: true,
      timestamp: 1,
    },
  ];

  assert.strictEqual(pruneHistoricalImages(messages), messages);
});
