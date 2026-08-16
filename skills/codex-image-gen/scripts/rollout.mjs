const topLevelTypes = new Set([
  "session_meta",
  "turn_context",
  "world_state",
  "response_item",
  "event_msg",
]);
const responseItemTypes = new Set([
  "message",
  "reasoning",
  "image_generation_call",
  "custom_tool_call",
  "custom_tool_call_output",
]);
const eventMessageTypes = new Set([
  "agent_message",
  "image_generation_end",
  "task_complete",
  "task_started",
  "token_count",
  "user_message",
]);

function validCustomInput(value) {
  if (typeof value !== "string") return false;
  const match = /^\/\/ @exec: [^\n]+\nconst result = await tools\.image_gen__imagegen\((\{[\s\S]*\})\);\s*generatedImage\(result\);\s*$/.exec(value);
  if (!match) return false;
  try {
    const arguments_ = JSON.parse(match[1]);
    return arguments_ !== null && !Array.isArray(arguments_) && typeof arguments_ === "object";
  } catch {
    return false;
  }
}

export function auditRollout(events, threadId) {
  if (!Array.isArray(events)) throw new Error("unsupported rollout schema: expected events");
  for (const event of events) {
    if (!event || typeof event !== "object" || !topLevelTypes.has(event.type)) {
      throw new Error(`unsupported rollout schema: ${event?.type || "missing event type"}`);
    }
    const payloadType = event.payload?.type;
    if (
      event.type === "response_item" &&
      typeof payloadType === "string" &&
      payloadType.endsWith("_call") &&
      payloadType !== "image_generation_call" &&
      payloadType !== "custom_tool_call"
    ) {
      throw new Error(`codex used another tool: ${payloadType}`);
    }
    if (
      (event.type === "response_item" && !responseItemTypes.has(payloadType)) ||
      (event.type === "event_msg" && !eventMessageTypes.has(payloadType))
    ) {
      throw new Error(
        `unsupported rollout schema: ${payloadType || "missing payload type"}`,
      );
    }
  }

  const sessionMetadata = events.filter((event) => event.type === "session_meta");
  if (
    sessionMetadata.length !== 1 ||
    sessionMetadata[0].payload?.id !== threadId ||
    sessionMetadata[0].payload?.session_id !== threadId
  ) {
    throw new Error("rollout session metadata did not match the Codex thread id");
  }

  const legacyCalls = events.filter(
    (event) =>
      event.type === "response_item" &&
      event.payload?.type === "image_generation_call",
  );
  const customCalls = events.filter(
    (event) =>
      event.type === "response_item" && event.payload?.type === "custom_tool_call",
  );
  const customOutputs = events.filter(
    (event) =>
      event.type === "response_item" &&
      event.payload?.type === "custom_tool_call_output",
  );

  if (legacyCalls.length) {
    if (legacyCalls.length !== 1 || customCalls.length || customOutputs.length) {
      throw new Error(`expected one image_gen call record, found ${legacyCalls.length}`);
    }
  } else if (customCalls.length || customOutputs.length) {
    if (customCalls.length !== 1 || customOutputs.length !== 1) {
      throw new Error("expected one image_gen custom call and output");
    }
    const call = customCalls[0].payload;
    const output = customOutputs[0].payload;
    if (
      call.name !== "exec" ||
      call.status !== "completed" ||
      !validCustomInput(call.input) ||
      typeof call.call_id !== "string" ||
      !call.call_id ||
      typeof output.call_id !== "string" ||
      !output.call_id ||
      output.call_id !== call.call_id
    ) {
      throw new Error("codex used an unsupported custom tool call");
    }
  } else {
    throw new Error("rollout did not record a supported image_gen call");
  }

  const endings = events.filter(
    (event) =>
      event.type === "event_msg" &&
      event.payload?.type === "image_generation_end",
  );
  if (endings.length !== 1) {
    throw new Error(`expected one image_gen end event, found ${endings.length}`);
  }
  const ending = endings[0].payload;
  if (typeof ending.call_id !== "string" || !ending.call_id) {
    throw new Error("image_gen did not record a valid call id");
  }

  if (legacyCalls.length) {
    const legacy = legacyCalls[0].payload;
    if (legacy.id !== ending.call_id) {
      throw new Error("image_gen call record did not match its end event");
    }
    if (legacy.status !== "generating" && legacy.status !== "completed") {
      throw new Error(`unsupported image_gen call status: ${legacy.status || "missing"}`);
    }
  }
  if (ending.status === "failed") throw new Error("image_gen generation failed");
  if (ending.status !== "completed") {
    throw new Error(`image_gen did not complete: ${ending.status || "missing"}`);
  }
  if (typeof ending.saved_path !== "string" || !ending.saved_path) {
    throw new Error("image_gen did not record one saved artifact");
  }
  return { callId: ending.call_id, savedPath: ending.saved_path };
}
