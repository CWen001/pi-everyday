import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Messages = ContextEvent["messages"];
type Message = Messages[number];

const OMITTED_IMAGE = {
  type: "text" as const,
  text: "[image omitted from active context; re-read its original path or ask the user to reattach it]",
};

function isImage(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const block = value as { type?: unknown; data?: unknown; mimeType?: unknown };
  return block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasContent(value: unknown): boolean {
  return typeof value === "string" || Array.isArray(value);
}

function canContainImages(message: unknown): message is Message {
  if (!isRecord(message) || typeof message.timestamp !== "number") return false;
  if (message.role === "user") return hasContent(message.content);
  if (message.role === "toolResult") {
    return (
      typeof message.toolCallId === "string" &&
      typeof message.toolName === "string" &&
      Array.isArray(message.content) &&
      typeof message.isError === "boolean"
    );
  }
  if (message.role === "custom") {
    return (
      typeof message.customType === "string" &&
      hasContent(message.content) &&
      typeof message.display === "boolean"
    );
  }
  return false;
}

function isUserMessage(message: unknown): boolean {
  return canContainImages(message) && message.role === "user";
}

export function pruneHistoricalImages(messages: Messages): Messages {
  let currentTurnStart = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (isUserMessage(messages[index])) {
      currentTurnStart = index;
      break;
    }
  }
  if (currentTurnStart < 0) return messages;

  let changed = false;
  const result = messages.map((message, index) => {
    if (index >= currentTurnStart || !canContainImages(message)) return message;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content) || !content.some(isImage)) return message;

    changed = true;
    return {
      ...message,
      content: content.map((block) => (isImage(block) ? { ...OMITTED_IMAGE } : block)),
    } as Message;
  });

  return changed ? result : messages;
}

export function registerImageContextPruning(pi: ExtensionAPI): void {
  pi.on("context", (event) => {
    try {
      return { messages: pruneHistoricalImages(event.messages) };
    } catch {
      return { messages: event.messages };
    }
  });
}
