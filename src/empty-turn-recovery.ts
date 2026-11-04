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

function completionResponse(entries: ProjectedSessionEntry[]) {
  let tools = false;
  let beforeReminder = false;
  for (let index = entries.length - 1; index >= 0; index--) {
    const { sourceEntry: entry, messages } = entries[index];
    if (entry.type === "custom_message") {
      if (entry.customType === "vscode-context") continue;
      if (messages.length === 0) return;
      if (entry.customType !== RECOVERY) return isCompletion(entry) ? { triggerId: entry.id, tools } : undefined;
      beforeReminder = true;
    } else if (entry.type === "message") {
      if (entry.message.role === "system") continue;
      // Omitted or edited tools still veto inactivity, but only in this response segment.
      const activity = [entry.message, ...messages].some((message) => message.role === "toolResult"
        || (message.role === "assistant" && message.content.some((part) => part.type === "toolCall")));
      if (activity) {
        if (!beforeReminder) tools = true;
        continue;
      }
      const message = messages[0];
      if (messages.length !== 1 || entry.message.role !== "assistant"
        || message?.role !== "assistant" || message.stopReason !== "stop") return;
    } else if (entry.type === "compaction" || entry.type === "branch_summary") return;
  }
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
    const response = completionResponse(event.context.contextEntries);
    if (!response || (!empty && response.tools)) return;

    // Processes and recovery receipts can survive a conversation branch change.
    const entries = ctx.sessionManager.getEntries();
    if (hasKnownWait(entries)) return;
    const receipts = entries.filter((entry) => entry.type === "custom" && entry.customType === RECOVERY
      && isRecord(entry.data) && entry.data.triggerId === response.triggerId);
    if (receipts.length >= 2 || receipts.some((entry) =>
      entry.type === "custom" && isRecord(entry.data) && entry.data.action === "stopped")) return;
    const retry = receipts.length === 0;
    return {
      entries: [
        ...event.entries,
        { type: "custom", customType: RECOVERY, data: { triggerId: response.triggerId, action: retry ? "retry" : "stopped" } },
        {
          type: "custom_message", customType: RECOVERY, display: true,
          content: retry
            ? `Pi Everyday detected ${empty ? "an empty" : "a tool-free"} reply after an agent completion and is checking once more. Reassess the original task within its existing authorization. If finished, blocked or waiting, say so. Existing human approvals and questions remain waiting. If awaiting a human, restate the gate and stop. Do not infer permission from worker completion or this reminder. Do not reset budgets, repeat a dispatched task, bypass approvals or retry an operation with an unknown outcome.`
            : "Pi Everyday stopped automatic recovery for this completion after one reassessment allowance. No further retry was scheduled. This does not determine whether the task is complete.",
        },
      ],
      ...(retry ? { continue: true } : {}),
    };
  });
}
