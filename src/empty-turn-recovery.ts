import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

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

export function registerEmptyTurnRecovery(pi: ExtensionAPI): void {
  pi.on("agent_before_settle", (event, ctx) => {
    if (event.outcome !== "completed" || event.continue
      || event.context.pendingMessages.length > 0 || ctx.hasPendingMessages() || ctx.signal?.aborted) return;
    const last = event.context.contextMessages.at(-1);
    if (last?.role !== "assistant" || last.stopReason !== "stop"
      || !last.content.every((part) => part.type === "thinking"
        || (part.type === "text" && part.text.trim() === ""))) return;

    const trigger = ctx.sessionManager.getBranch().reverse().find((entry) =>
      (entry.type === "message" && entry.message.role === "user")
      || (entry.type === "custom_message" && entry.customType !== RECOVERY
        && entry.customType !== "vscode-context"));
    if (trigger?.type !== "custom_message" || trigger.customType !== "pstack-agent"
      || !isRecord(trigger.details) || trigger.details.status !== "completed"
      || typeof trigger.details.agentId !== "string") return;

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
            ? "Pi Everyday detected an empty reply after an agent completion and is checking once more. Reassess the original task within its existing authorization. If finished, blocked or waiting, say so. Do not reset budgets, repeat a dispatched task, bypass approvals or retry an operation with an unknown outcome."
            : "Pi Everyday stopped automatic recovery after a second empty reply. No further retry was scheduled; the task may still be unfinished.",
        },
      ],
      ...(retry ? { continue: true } : {}),
    };
  });
}
