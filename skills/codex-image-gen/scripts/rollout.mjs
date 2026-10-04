// Interpret evidence, never execute or statically "approve" recorded JavaScript.
const informational = new Set([
  "session_meta", "turn_context", "world_state", "message", "reasoning",
  "agent_message", "agent_reasoning", "task_complete", "task_started",
  "token_count", "user_message", "function_call_output", "custom_tool_call_output",
]);
const supportingTools = new Set(["wait", "view_image"]);
const imageTools = new Set(["image_gen", "image_gen.imagegen", "image_gen__imagegen"]);
const prohibitedTools = new Set(["apply_patch", "exec_command", "shell", "shell_command", "write_stdin", "web.run"]);

export function auditRollout(events, threadId) {
  if (!Array.isArray(events)) throw new Error("expected rollout events");
  const metadata = events.filter((event) => event?.type === "session_meta");
  if (metadata.length !== 1 || metadata[0].payload?.id !== threadId ||
      (metadata[0].payload.session_id != null && metadata[0].payload.session_id !== threadId)) {
    throw new Error("rollout session metadata did not match the Codex thread id");
  }
  const generations = new Map();
  const imageCalls = new Set();
  const warnings = new Set();
  const violations = new Set();
  const toolErrors = [];
  const evidenceErrors = new Set();
  let countUncertain = false;
  function unrecognized(message, kind) {
    warnings.add(message);
    if (typeof kind !== "string" || !kind || /image[_.]?gen/i.test(kind)) countUncertain = true;
  }
  function generation(id) {
    if (typeof id !== "string" || !id) {
      evidenceErrors.add("image generation missing a valid call id");
      warnings.add("invalid image evidence");
      countUncertain = true;
      return undefined;
    }
    if (!generations.has(id)) generations.set(id, { callId: id });
    return generations.get(id);
  }
  function completed(payload) {
    const knownFields = ["type", "kind", "call_id", "id", "status", "saved_path", "savedPath", "result",
      "failure", "revised_prompt", "revisedPrompt", "transparent_background", "transparentBackground",
      "imagegen_request_id", "imagegenRequestId", "generation_id", "generationId"];
    if (Object.keys(payload).some((key) => !knownFields.includes(key))) warnings.add("unrecognized completion fields");
    const record = generation(payload.call_id ?? payload.id);
    if (!record || record.invalid) return;
    const savedPath = payload.saved_path ?? payload.savedPath;
    const data = payload.result;
    if ((record.savedPath && savedPath && record.savedPath !== savedPath) ||
        (record.data && data && record.data !== data)) {
      record.invalid = true;
      evidenceErrors.add("conflicting artifact provenance for one generation");
      warnings.add("invalid image evidence");
      return;
    }
    if (payload.status === "completed") {
      record.status = "completed";
      delete record.failure;
      if (typeof savedPath === "string" && savedPath) record.savedPath = savedPath;
      if (typeof data === "string" && data) record.data = data;
      if (!record.savedPath && !record.data) warnings.add("completed generation has no recoverable artifact");
    } else if (payload.status === "failed" || payload.failure) {
      record.status = "failed";
      record.failure = payload.failure ?? { message: "image generation failed" };
    } else {
      warnings.add("generation has an unrecognized completion status");
    }
  }
  for (const event of events) {
    const payload = event?.payload;
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      warnings.add("malformed rollout event"); countUncertain = true; continue;
    }
    if (payload?.thread_id != null && payload.thread_id !== threadId) {
      throw new Error("rollout event did not match the Codex thread id");
    }
    if (["response_item", "event_msg"].includes(event.type)) {
      const type = payload?.type;
      if (type === "image_generation_call" || type === "image_generation_begin") {
        generation(payload.call_id ?? payload.id);
      } else if (type === "image_generation_end") {
        completed(payload);
      } else if (["item_started", "item_completed"].includes(type)) {
        const item = payload.item;
        if (item?.type === "Extension" && item.kind === "image_gen.generation") {
          if (type === "item_completed") completed(item);
          else generation(item.id);
        } else if (!["AgentMessage", "Reasoning", "UserMessage"].includes(item?.type)) {
          unrecognized("unrecognized completed/started item", item?.type === "Extension" ? item.kind : item?.type);
        }
      } else if (["function_call", "custom_tool_call"].includes(type)) {
        if (prohibitedTools.has(payload.name)) violations.add(`unexpected tool: ${payload.name}`);
        else if (imageTools.has(payload.name)) {
          const id = payload.call_id ?? payload.id;
          if (typeof id === "string" && id) imageCalls.add(id);
          else unrecognized("image tool invocation missing a valid call id");
        } else if (!supportingTools.has(payload.name)) {
          // An exec wrapper can contain arbitrary code. Only native completion evidence
          // establishes the image; this is explicitly NOT a hard tool allowlist.
          unrecognized(payload.name === "exec" ? "exec wrapper behavior is not fully verified" : "unrecognized tool behavior", payload.name);
        }
      } else if (["exec_command_begin", "patch_apply_begin"].includes(type)) {
        violations.add(`unexpected execution: ${type}`);
      } else if (type === "error") {
        warnings.add("Codex recorded an execution error");
        toolErrors.push(payload.message || "Codex execution error");
      } else if (["function_call_output", "custom_tool_call_output"].includes(type)) {
        if (typeof payload.output === "string" && /error|failed|usage.?limit|rate.?limit|refus|unauthoriz/i.test(payload.output)) {
          toolErrors.push(payload.output);
        }
      } else if (!informational.has(type)) {
        unrecognized("unrecognized rollout payload", type);
      }
    } else if (!informational.has(event.type)) {
      unrecognized("unrecognized rollout event", event.type);
    }
  }
  if ([...imageCalls].some((id) => !generations.has(id))) {
    unrecognized("image tool invocation missing matching generation evidence");
  }
  const records = [...generations.values()];
  return {
    artifacts: records.filter((record) => !record.invalid && record.status === "completed" && (record.savedPath || record.data)),
    submissions: records.length,
    countUncertain,
    evidenceErrors: [...evidenceErrors],
    pending: records.some((record) => !record.invalid && !record.status),
    failures: records.filter((record) => record.failure).map((record) => record.failure),
    toolErrors,
    check: {
      status: violations.size ? "violation" : warnings.size ? "incomplete" : "verified",
      warnings: [...warnings],
      violations: [...violations],
    },
  };
}
