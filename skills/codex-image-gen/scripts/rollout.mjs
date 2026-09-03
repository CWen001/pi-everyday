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
  "function_call",
  "function_call_output",
]);
const eventMessageTypes = new Set([
  "agent_message",
  "image_generation_end",
  "item_completed",
  "task_complete",
  "task_started",
  "token_count",
  "user_message",
]);
const completedItemTypes = new Set([
  "AgentMessage",
  "Extension",
  "Reasoning",
  "UserMessage",
]);

function validCustomInput(value) {
  if (typeof value !== "string") return false;
  const json = /^\/\/ @exec: [^\n]+\nconst result = await tools\.image_gen__imagegen\((\{[\s\S]*\})\);\s*generatedImage\(result\);\s*$/.exec(value);
  if (json) {
    try {
      const arguments_ = JSON.parse(json[1]);
      return arguments_ !== null && !Array.isArray(arguments_) && typeof arguments_ === "object";
    } catch {
      // Current Codex emits the same call as a JavaScript object below.
    }
  }
  const javascript = /^(?:\/\/ @exec: [^\n]+\n)?const ([A-Za-z_$][\w$]*) = await tools\.image_gen__imagegen\(\{\s*prompt:\s*`([\s\S]*)`(?:,\s*referenced_image_paths:\s*(null|\[[^\n]*\]))?\s*,?\s*\}\);\s*generatedImage\(\1\);\s*$/.exec(value);
  if (javascript && !javascript[2].includes("`") && !javascript[2].includes("${")) {
    if (!javascript[3] || javascript[3] === "null") return true;
    try {
      const paths = JSON.parse(javascript[3]);
      return Array.isArray(paths) && paths.every((path) => typeof path === "string");
    } catch {
      return false;
    }
  }
  const previousImage = /^(?:\/\/ @exec: [^\n]+\n)?const ([A-Za-z_$][\w$]*) = await tools\.image_gen__imagegen\(\{\s*num_last_images_to_include:\s*([1-5]),\s*prompt:\s*`([\s\S]*)`\s*,?\s*\}\);\s*generatedImage\(\1\);\s*$/.exec(value);
  return Boolean(previousImage && !previousImage[3].includes("`") && !previousImage[3].includes("${"));
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
      payloadType !== "custom_tool_call" &&
      !(payloadType === "function_call" && event.payload?.name === "wait")
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
    if (event.type === "event_msg" && payloadType === "item_completed") {
      const item = event.payload?.item;
      if (event.payload?.thread_id !== threadId) {
        throw new Error("completed item did not match the Codex thread id");
      }
      if (!item || !completedItemTypes.has(item.type)) {
        throw new Error(`unsupported completed item: ${item?.type || "missing item type"}`);
      }
      if (item.type === "Extension" && item.kind !== "image_gen.generation") {
        throw new Error(`unsupported completed extension: ${item.kind || "missing kind"}`);
      }
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
  const waits = events.filter(
    (event) => event.type === "response_item" && event.payload?.type === "function_call",
  );
  const waitOutputs = events.filter(
    (event) => event.type === "response_item" && event.payload?.type === "function_call_output",
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

  if (waits.length || waitOutputs.length) {
    if (!customCalls.length || waits.length !== 1 || waitOutputs.length !== 1) {
      throw new Error("expected one image_gen wait call and output");
    }
    const wait = waits[0].payload;
    const output = waitOutputs[0].payload;
    let arguments_;
    try {
      arguments_ = JSON.parse(wait.arguments);
    } catch {
      throw new Error("image_gen used an unsupported wait call");
    }
    if (
      wait.name !== "wait" ||
      output.call_id !== wait.call_id ||
      Object.keys(arguments_).sort().join(",") !== "cell_id,max_tokens,yield_time_ms" ||
      typeof arguments_.cell_id !== "string" ||
      !arguments_.cell_id ||
      !Number.isInteger(arguments_["yield_time_ms"]) ||
      arguments_["yield_time_ms"] < 1 ||
      arguments_["yield_time_ms"] > 120_000 ||
      !Number.isInteger(arguments_.max_tokens) ||
      arguments_.max_tokens < 1 ||
      arguments_.max_tokens > 10_000 ||
      typeof customOutputs[0].payload.output !== "string" ||
      !customOutputs[0].payload.output.includes(`Script running with cell ID ${arguments_.cell_id}`)
    ) {
      throw new Error("image_gen used an unsupported wait call");
    }
  }

  const endings = events.filter(
    (event) =>
      event.type === "event_msg" &&
      event.payload?.type === "image_generation_end",
  );
  const completedExtensions = events.filter(
    (event) =>
      event.type === "event_msg" &&
      event.payload?.type === "item_completed" &&
      event.payload?.item?.type === "Extension",
  );
  if (endings.length + completedExtensions.length !== 1) {
    throw new Error(`expected one image_gen end event, found ${endings.length + completedExtensions.length}`);
  }
  const ending = endings.length
    ? endings[0].payload
    : {
        call_id: completedExtensions[0].payload.item.id,
        status: completedExtensions[0].payload.item.status,
        saved_path: completedExtensions[0].payload.item.savedPath,
        failure: completedExtensions[0].payload.item.failure,
      };
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
  if (ending.status === "failed" || ending.failure) throw new Error("image_gen generation failed");
  if (ending.status !== "completed") {
    throw new Error(`image_gen did not complete: ${ending.status || "missing"}`);
  }
  if (typeof ending.saved_path !== "string" || !ending.saved_path) {
    throw new Error("image_gen did not record one saved artifact");
  }
  return { callId: ending.call_id, savedPath: ending.saved_path };
}
