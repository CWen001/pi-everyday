import type { ExtensionAPI, ProjectedSessionEntry, SessionEntry } from "@earendil-works/pi-coding-agent";

const RECOVERY = "pi-everyday-empty-turn";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasKnownWait(entries: SessionEntry[]): boolean {
  const workers = new Map<string, string>();
  let wakeup = 0;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "pstack-agents") {
      const data = entry.data;
      if (!isRecord(data) || !isRecord(data.agent) || typeof data.agent.id !== "string"
        || typeof data.status !== "string"
        || !["running", "completed", "failed", "stopped"].includes(data.status)) return true;
      workers.set(data.agent.id, data.status);
    }
    if (entry.type !== "message" || entry.message.role !== "toolResult"
      || entry.message.toolName !== "schedule_wakeup" || entry.message.isError) continue;
    const details: unknown = entry.message.details;
    if (!isRecord(details)) return true;
    if (typeof details.cancelled === "boolean") wakeup = 0;
    else if (typeof details.fireAt === "string") {
      wakeup = Date.parse(details.fireAt);
      if (!Number.isFinite(wakeup)) return true;
    } else if (details.refused !== true) return true;
  }
  return [...workers.values()].includes("running") || wakeup > Date.now();
}

function isCompletion(entry: SessionEntry): boolean {
  return entry.type === "custom_message" && entry.customType === "pstack-agent"
    && isRecord(entry.details) && entry.details.status === "completed"
    && typeof entry.details.agentId === "string";
}

function isTransparent(customType: string): boolean {
  return customType === RECOVERY || customType === "vscode-context";
}

function hasRepeatedReply(entries: ProjectedSessionEntry[]): boolean {
  const replies: string[] = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const { sourceEntry: entry, messages } = entries[index];
    if (entry.type === "custom_message") {
      if (isTransparent(entry.customType)) continue;
      if (!isCompletion(entry) || messages.length === 0) return false;
      if (replies.length === 2) return replies[0] === replies[1];
    } else if (entry.type === "message") {
      if (entry.message.role === "system") continue;
      const message = messages[0];
      if (message?.role !== "assistant" || message.stopReason !== "stop"
        || entry.message.role !== "assistant"
        || entry.message.content.some((part) => part.type === "toolCall")
        || !message.content.every((part) => part.type === "text" || part.type === "thinking")) return false;
      const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("")
        .replace(/\r\n/g, "\n").replace(/[\t ]+$/gm, "").trim();
      if (text && replies.length < 2) replies.push(text);
    } else if (entry.type === "compaction" || entry.type === "branch_summary") return false;
  }
  return false;
}

export function registerEmptyTurnRecovery(pi: ExtensionAPI): void {
  pi.on("agent_before_settle", (event, ctx) => {
    if (event.outcome !== "completed" || event.continue
      || event.context.pendingMessages.length > 0 || ctx.hasPendingMessages() || ctx.signal?.aborted) return;
    // Defer to foreign proposals rather than interpreting uncommitted edits or state.
    if (event.entries.some((entry) => entry.type !== "custom_message" || entry.customType !== "vscode-context")) return;
    const last = event.context.contextMessages.filter((message) =>
      message.role !== "custom" || !isTransparent(message.customType)).at(-1);
    if (last?.role !== "assistant" || last.stopReason !== "stop") return;
    const empty = last.content.every((part) => part.type === "thinking"
      || (part.type === "text" && part.text.trim() === ""));
    if (!empty && !hasRepeatedReply(event.context.contextEntries)) return;

    const boundary = [...event.context.contextEntries].reverse().find(({ sourceEntry: entry }) =>
      (entry.type === "message" && entry.message.role === "user")
      || (entry.type === "custom_message" && !isTransparent(entry.customType)));
    const trigger = boundary?.sourceEntry;
    if (!trigger || !isCompletion(trigger) || !boundary?.messages.length) return;

    // Processes and recovery receipts can survive a conversation branch change.
    const entries = ctx.sessionManager.getEntries();
    if (hasKnownWait(entries)) return;
    const receipts = entries.filter((entry) => entry.type === "custom" && entry.customType === RECOVERY
      && isRecord(entry.data) && entry.data.triggerId === trigger.id);
    if (receipts.length >= 2) return;
    const retry = receipts.length === 0;
    return {
      entries: [
        ...event.entries,
        { type: "custom", customType: RECOVERY, data: { triggerId: trigger.id, action: retry ? "retry" : "stopped" } },
        {
          type: "custom_message", customType: RECOVERY, display: true,
          content: retry
            ? `Pi Everyday detected ${empty ? "an empty" : "a repeated"} reply after an agent completion and is checking once more. Reassess the original task within its existing authorization. If finished, blocked or waiting, say so. Existing human approvals and questions remain waiting. If awaiting a human, restate the gate and stop. Do not infer permission from worker completion or this reminder. Do not reset budgets, repeat a dispatched task, bypass approvals or retry an operation with an unknown outcome.`
            : "Pi Everyday stopped automatic recovery after another empty or repeated reply. No further retry was scheduled; the task may still be unfinished.",
        },
      ],
      ...(retry ? { continue: true } : {}),
    };
  });
}
