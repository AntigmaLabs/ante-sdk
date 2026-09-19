import type {
  ApprovalRequest,
  AmbientKind,
  ContextBreakdown,
  InfoBlock,
  McpServerInfo,
  McpToolInfo,
  ModelSpec,
  ProcessLane,
  ProcessStep,
  ProviderSpec,
  QuestionRequest,
  SkillInfo,
  SubagentInfo,
  ToolCall,
  Usage,
} from "../types.js";

const getStringField = (value: unknown, keys: string[]): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return null;
};

const findNestedStringField = (value: unknown, keys: string[]): string | null => {
  const direct = getStringField(value, keys);
  if (direct) {
    return direct;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findNestedStringField(entry, keys);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    const nested = findNestedStringField(nestedValue, keys);
    if (nested) {
      return nested;
    }
  }
  return null;
};

const findNestedNumberField = (value: unknown, keys: string[]): number | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findNestedNumberField(entry, keys);
      if (nested != null) {
        return nested;
      }
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const nested = findNestedNumberField(nestedValue, keys);
    if (nested != null) {
      return nested;
    }
  }
  return undefined;
};

export const getVariant = (event: unknown): { name: string; payload: unknown } | null => {
  if (typeof event === "string") {
    return { name: event, payload: undefined };
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const entries = Object.entries(event as Record<string, unknown>);
  if (entries.length !== 1) {
    return null;
  }
  return { name: entries[0][0], payload: entries[0][1] };
};

export const extractText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => extractText(entry)).join("");
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  for (const key of ["text", "delta", "message", "content"]) {
    const extracted = extractText(record[key]);
    if (extracted) {
      return extracted;
    }
  }
  for (const key of ["parts", "responses"]) {
    const extracted = extractText(record[key]);
    if (extracted) {
      return extracted;
    }
  }
  return "";
};

export const extractErrorMessage = (value: unknown): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Check status.Failed/status.Error pattern
    if (record.status && typeof record.status === "object" && !Array.isArray(record.status)) {
      const statusRecord = record.status as Record<string, unknown>;
      const failedStatus = statusRecord.Failed ?? statusRecord.Error;
      if (failedStatus) {
        if (typeof failedStatus === "string") {
          return failedStatus;
        }
        if (failedStatus && typeof failedStatus === "object") {
          const failedRecord = failedStatus as Record<string, unknown>;
          const detailText = Array.isArray(failedRecord.details)
            ? failedRecord.details.filter((detail) => typeof detail === "string" && detail.trim()).join("\n")
            : typeof failedRecord.details === "string"
              ? failedRecord.details.trim()
              : "";
          const headline = typeof failedRecord.headline === "string" ? failedRecord.headline.trim() : "";
          if (headline && detailText) {
            return `${headline}: ${detailText}`;
          }
          if (detailText) {
            return detailText;
          }
          const nested = findNestedStringField(failedStatus, [
            "headline",
            "message",
            "error",
            "description",
            "details",
          ]);
          if (nested) {
            return nested;
          }
          try {
            return JSON.stringify(failedStatus);
          } catch {
            return String(failedStatus);
          }
        }
      }
    }
    const direct = findNestedStringField(value, ["message", "error", "description", "details"]);
    if (direct) {
      return direct;
    }
    // General fallback: serialize the payload
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return "Ante returned an unknown error";
};

export const extractUsage = (value: unknown): Usage => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { raw: value };
  }

  return {
    promptTokens: findNestedNumberField(value, [
      "prompt_tokens",
      "promptTokens",
      "input_tokens",
      "inputTokens",
      "prompt_token_count",
      "input_token_count",
    ]),
    completionTokens: findNestedNumberField(value, [
      "completion_tokens",
      "completionTokens",
      "output_tokens",
      "outputTokens",
      "completion_token_count",
      "output_token_count",
    ]),
    totalTokens: findNestedNumberField(value, ["total_tokens", "totalTokens", "total_token_count"]),
    raw: value,
  };
};

export const extractInfoMessage = (value: unknown): string | undefined => {
  const text = extractText(value).trim();
  if (text) {
    return text;
  }
  const direct = findNestedStringField(value, ["message", "text", "content", "details"]);
  return direct?.trim() || undefined;
};

export const extractTurnPauseApproval = (value: unknown): ApprovalRequest | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const turnId = typeof record.turn_id === "string" ? record.turn_id.trim() : "";
  const reason = record.reason;
  if (!reason || typeof reason !== "object" || Array.isArray(reason)) {
    return null;
  }
  const approval = (reason as Record<string, unknown>).Approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    return null;
  }

  const approvalRecord = approval as Record<string, unknown>;
  const message =
    findNestedStringField(approvalRecord, ["message"]) ?? "Please approve the following tool calls";
  const tools = Array.isArray(approvalRecord.tools)
    ? approvalRecord.tools.reduce<ApprovalRequest["tools"]>((all, tool) => {
        if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
          return all;
        }
        const toolRecord = tool as Record<string, unknown>;
        const name = typeof toolRecord.name === "string" ? toolRecord.name.trim() : "";
        const id = typeof toolRecord.id === "string" ? toolRecord.id.trim() : "";
        if (!id) {
          return all;
        }
        const argsText =
          toolRecord.args && typeof toolRecord.args === "object" && !Array.isArray(toolRecord.args)
            ? JSON.stringify(toolRecord.args)
            : undefined;
        all.push({
          id,
          name: name || "Tool",
          argsText,
        });
        return all;
      }, [])
    : [];

  if (!turnId) {
    return null;
  }

  return {
    turnId,
    message,
    tools,
  };
};

export const extractTurnPauseQuestion = (value: unknown): QuestionRequest | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const turnId = typeof record.turn_id === "string" ? record.turn_id.trim() : "";
  const question = record.reason && typeof record.reason === "object" && !Array.isArray(record.reason)
    ? (record.reason as Record<string, unknown>).Question
    : undefined;
  if (!turnId || !question || typeof question !== "object" || Array.isArray(question)) {
    return null;
  }
  const questionRecord = question as Record<string, unknown>;
  const toolUseId = typeof questionRecord.tool_use_id === "string" ? questionRecord.tool_use_id.trim() : "";
  if (!toolUseId || !Array.isArray(questionRecord.questions)) {
    return null;
  }
  const questions = questionRecord.questions.reduce<QuestionRequest["questions"]>((all, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return all;
    const item = entry as Record<string, unknown>;
    const header = typeof item.header === "string" ? item.header : "";
    const text = typeof item.question === "string" ? item.question : "";
    if (!header || !text || !Array.isArray(item.options)) return all;
    const options = item.options.reduce<QuestionRequest["questions"][number]["options"]>((choices, choice) => {
      if (!choice || typeof choice !== "object" || Array.isArray(choice)) return choices;
      const option = choice as Record<string, unknown>;
      if (typeof option.label !== "string" || typeof option.description !== "string") return choices;
      choices.push({
        label: option.label,
        description: option.description,
        preview: typeof option.preview === "string" ? option.preview : undefined,
      });
      return choices;
    }, []);
    all.push({ header, question: text, multiSelect: item.multi_select === true, options });
    return all;
  }, []);
  return { turnId, toolUseId, questions };
};

export const extractShellOutput = (value: unknown): { command: string; stdout: string; stderr: string; exitCode?: number } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.command !== "string" || typeof record.stdout !== "string" || typeof record.stderr !== "string") {
    return null;
  }
  return {
    command: record.command,
    stdout: record.stdout,
    stderr: record.stderr,
    exitCode: typeof record.exit_code === "number" ? record.exit_code : undefined,
  };
};

export const extractInfoBlock = (value: unknown, phase: "start" | "append"): InfoBlock | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  if (!id) return null;
  if (phase === "start") {
    return typeof record.header === "string" ? { id, header: record.header, loading: record.loading === true } : null;
  }
  return typeof record.detail === "string" ? { id, detail: record.detail } : null;
};

export const extractContextBreakdown = (value: unknown): ContextBreakdown | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const required = [
    "system_prompt_tokens", "system_tools_tokens", "mcp_tools_tokens", "memory_tokens", "skills_tokens",
    "messages_tokens", "used_tokens", "compact_buffer_tokens",
  ];
  if (required.some((key) => typeof record[key] !== "number")) return null;
  return {
    systemPromptTokens: record.system_prompt_tokens as number,
    systemToolsTokens: record.system_tools_tokens as number,
    mcpToolsTokens: record.mcp_tools_tokens as number,
    memoryTokens: record.memory_tokens as number,
    skillsTokens: record.skills_tokens as number,
    messagesTokens: record.messages_tokens as number,
    usedTokens: record.used_tokens as number,
    limitTokens: typeof record.limit_tokens === "number" ? record.limit_tokens : undefined,
    compactBufferTokens: record.compact_buffer_tokens as number,
  };
};

export const extractAmbient = (value: unknown): { kind: AmbientKind; requestId: number; text: string } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if ((kind !== "ThinkingPhrase" && kind !== "PromptSuggestion") || typeof record.req_id !== "number" || typeof record.text !== "string") {
    return null;
  }
  return { kind, requestId: record.req_id, text: record.text };
};

export const extractTurnPauseDetail = (value: unknown): string => {
  const approval = extractTurnPauseApproval(value);
  if (!approval) {
    return "";
  }
  const toolSummary =
    approval.tools.length > 0
      ? `Approval required for ${approval.tools.map((tool) => `${tool.name} ${tool.id}`.trim()).join(", ")}`
      : "Approval required";
  return [toolSummary, approval.message].filter(Boolean).join(": ");
};

const normalizeProcessStepStatus = (value: unknown): ProcessStep["status"] => {
  if (typeof value !== "string") {
    return "pending";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "completed" || normalized === "done") {
    return "completed";
  }
  if (
    normalized === "in_progress" ||
    normalized === "in-progress" ||
    normalized === "active" ||
    normalized === "running"
  ) {
    return "in_progress";
  }
  return "pending";
};

const extractTodoSteps = (value: unknown): ProcessStep[] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record.todos,
    record.args && typeof record.args === "object" && !Array.isArray(record.args)
      ? (record.args as Record<string, unknown>).todos
      : undefined,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    return candidate.reduce<ProcessStep[]>((steps, entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return steps;
      }
      const todo = entry as Record<string, unknown>;
      const labelCandidate = typeof todo.content === "string" ? todo.content.trim() : "";
      const activeLabelCandidate =
        typeof todo.activeForm === "string" ? todo.activeForm.trim() : "";
      const label = labelCandidate || activeLabelCandidate;
      if (!label) {
        return steps;
      }
      steps.push({
        id: typeof todo.id === "string" && todo.id.trim() ? todo.id.trim() : `todo-${index}`,
        label,
        activeLabel: activeLabelCandidate || undefined,
        status: normalizeProcessStepStatus(todo.status),
      });
      return steps;
    }, []);
  }

  return [];
};

export const buildProcessLaneFromToolPayload = (
  eventName: "ToolStart" | "ToolUpdate" | "ToolEnd",
  payload: unknown,
  current: ProcessLane | undefined,
): ProcessLane | undefined => {
  const toolName = getStringField(payload, ["name", "tool_name"]) ?? current?.toolName;
  const todoSteps = extractTodoSteps(payload);

  if (toolName === "TodoWrite" && todoSteps.length > 0) {
    const activeStep =
      todoSteps.find((step) => step.status === "in_progress") ??
      todoSteps.find((step) => step.status === "pending") ??
      todoSteps[0];
    return {
      phase: "planning",
      label: activeStep?.activeLabel ?? activeStep?.label ?? "Updating plan",
      toolName,
      steps: todoSteps,
    };
  }

  if (eventName === "ToolEnd") {
    return current;
  }

  if (!toolName) {
    return undefined;
  }

  return {
    phase: "running",
    label: `Running ${toolName}`,
    toolName,
    steps: current?.steps ?? [],
  };
};

export const extractToolCall = (
  eventName: "ToolStart" | "ToolEnd",
  payload: unknown,
): ToolCall | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const idCandidate = eventName === "ToolEnd" ? record.tool_use_id : record.id;
  const id = typeof idCandidate === "string" ? idCandidate.trim() : "";
  if (!id) {
    return null;
  }

  const name = getStringField(record, ["name", "tool_name"]) ?? "Tool";
  const argsText =
    record.args && typeof record.args === "object" && !Array.isArray(record.args)
      ? JSON.stringify(record.args)
      : undefined;
  const resultText =
    record.result_json == null
      ? undefined
      : typeof record.result_json === "string"
        ? record.result_json
        : typeof record.result_json === "object" && !Array.isArray(record.result_json)
          ? JSON.stringify(record.result_json)
          : undefined;
  const status = getStringField(record, ["status"]) ?? undefined;

  return {
    id,
    name,
    argsText,
    resultText,
    status,
    // `ToolEnd.status` has no `is_error` wire field — the daemon's own
    // `ToolEndStatus::is_error()` treats anything but `"Completed"` as an
    // error (Cancelled/Denied/Failed). `ToolStart` has no status yet.
    isError: eventName === "ToolEnd" && status != null && status !== "Completed",
  };
};

export const extractExtensionRefreshed = (
  value: unknown,
): { skills: SkillInfo[]; subagents: SubagentInfo[]; mcpServers: McpServerInfo[] } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { skills: [], subagents: [], mcpServers: [] };
  }
  const record = value as Record<string, unknown>;

  const skills = Array.isArray(record.skills)
    ? record.skills.reduce<SkillInfo[]>((all, entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return all;
        }
        const skill = entry as Record<string, unknown>;
        const name = typeof skill.name === "string" ? skill.name.trim() : "";
        if (!name) {
          return all;
        }
        all.push({
          name,
          description: typeof skill.description === "string" ? skill.description : undefined,
          scope: typeof skill.scope === "string" ? skill.scope : undefined,
          argumentHint: typeof skill.argument_hint === "string" ? skill.argument_hint : undefined,
        });
        return all;
      }, [])
    : [];

  const subagents = Array.isArray(record.subagents)
    ? record.subagents.reduce<SubagentInfo[]>((all, entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return all;
        }
        const subagent = entry as Record<string, unknown>;
        const name = typeof subagent.name === "string" ? subagent.name.trim() : "";
        if (!name) {
          return all;
        }
        all.push({
          name,
          description: typeof subagent.description === "string" ? subagent.description : undefined,
          scope: typeof subagent.scope === "string" ? subagent.scope : undefined,
        });
        return all;
      }, [])
    : [];

  const mcpServers = Array.isArray(record.mcp_servers)
    ? record.mcp_servers.reduce<McpServerInfo[]>((all, entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return all;
        }
        const server = entry as Record<string, unknown>;
        const name = typeof server.name === "string" ? server.name.trim() : "";
        if (!name) {
          return all;
        }
        const tools = Array.isArray(server.tools)
          ? server.tools.reduce<McpToolInfo[]>((allTools, toolEntry) => {
              if (!toolEntry || typeof toolEntry !== "object" || Array.isArray(toolEntry)) {
                return allTools;
              }
              const tool = toolEntry as Record<string, unknown>;
              const toolName = typeof tool.name === "string" ? tool.name.trim() : "";
              if (!toolName) {
                return allTools;
              }
              const parameters = Array.isArray(tool.parameters)
                ? tool.parameters.reduce<McpToolInfo["parameters"]>((allParams, paramEntry) => {
                    if (!paramEntry || typeof paramEntry !== "object" || Array.isArray(paramEntry)) {
                      return allParams;
                    }
                    const param = paramEntry as Record<string, unknown>;
                    const paramName = typeof param.name === "string" ? param.name.trim() : "";
                    if (!paramName) {
                      return allParams;
                    }
                    allParams.push({
                      name: paramName,
                      paramType: typeof param.param_type === "string" ? param.param_type : undefined,
                      required: typeof param.required === "boolean" ? param.required : undefined,
                      description: typeof param.description === "string" ? param.description : undefined,
                    });
                    return allParams;
                  }, [])
                : [];
              allTools.push({
                name: toolName,
                qualifiedName: typeof tool.qualified_name === "string" ? tool.qualified_name : undefined,
                description: typeof tool.description === "string" ? tool.description : undefined,
                parameters,
              });
              return allTools;
            }, [])
          : [];
        all.push({
          name,
          command: typeof server.command === "string" ? server.command : undefined,
          args: Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === "string") : undefined,
          tools,
        });
        return all;
      }, [])
    : [];

  return { skills, subagents, mcpServers };
};

export const extractSessionId = (value: unknown): string | null =>
  getStringField(value, ["session_id", "sessionId", "id"]);

export const extractModelSpec = (value: unknown): ModelSpec | null => {
  if (typeof value === "string" && value.trim()) {
    return { name: value.trim() };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  // Ante's daemon reports models as `{ id, ... }`, not `{ name, ... }` (see
  // SessionStart.model in the Protocol Reference). Prefer `id`, falling back
  // to `name` for callers that already normalize their own payloads.
  const name =
    (typeof record.id === "string" && record.id.trim()) ||
    (typeof record.name === "string" && record.name.trim()) ||
    "";
  if (!name) {
    return null;
  }
  return {
    name,
    description:
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : undefined,
    thinking:
      typeof record.thinking === "string" && record.thinking.trim()
        ? record.thinking.trim()
        : undefined,
  };
};

export const extractSessionModelSpec = (value: unknown): ModelSpec | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return extractModelSpec((value as Record<string, unknown>).model);
};

export const extractProviderSpec = (value: unknown): ProviderSpec | null => {
  if (typeof value === "string" && value.trim()) {
    return { name: value.trim(), preferredModels: [] };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  // Same `id` vs `name` mismatch as extractModelSpec above — the daemon
  // reports providers as `{ id, display_name, ... }`.
  const name =
    (typeof record.id === "string" && record.id.trim()) ||
    (typeof record.name === "string" && record.name.trim()) ||
    "";
  if (!name) {
    return null;
  }
  const rawModels = Array.isArray(record.preferred_models)
    ? record.preferred_models
    : Array.isArray(record.preferredModels)
      ? record.preferredModels
      : [];
  return {
    name,
    displayName:
      typeof record.display_name === "string" && record.display_name.trim()
        ? record.display_name.trim()
        : typeof record.displayName === "string" && record.displayName.trim()
          ? record.displayName.trim()
          : undefined,
    baseUrl:
      typeof record.base_url === "string" && record.base_url.trim()
        ? record.base_url.trim()
        : typeof record.baseUrl === "string" && record.baseUrl.trim()
          ? record.baseUrl.trim()
          : undefined,
    preferredModels: rawModels.flatMap((entry) => {
      const model = extractModelSpec(entry);
      return model ? [model] : [];
    }),
  };
};

export const extractSessionProviderSpec = (value: unknown): ProviderSpec | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return extractProviderSpec((value as Record<string, unknown>).provider);
};

export const extractTurnStatus = (value: unknown): string | null => {
  const direct = getStringField(value, ["status", "finish_reason", "finishReason"]);
  if (direct) {
    return direct;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["status", "finish_reason", "finishReason"]) {
    const candidate = record[key];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const entries = Object.entries(candidate as Record<string, unknown>);
    if (entries.length === 1 && entries[0]?.[0]) {
      return entries[0][0];
    }
  }
  return null;
};

const extractJsonCandidates = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = trimmed.replace(/\s*\[end_turn\]\s*$/i, "").trim();
  const candidates: string[] = [];
  const exactFence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(normalized);
  if (exactFence?.[1]) {
    candidates.push(exactFence[1].trim());
  }

  const fencePattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  for (const match of normalized.matchAll(fencePattern)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.push(candidate);
    }
  }

  candidates.push(normalized);
  return [...new Set(candidates)];
};

const parseJsonPayload = (value: string): unknown => {
  for (const candidate of extractJsonCandidates(value)) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next candidate, for example a fenced JSON block inside prose.
    }
  }
  return null;
};

const extractTopLevelJsonObject = (value: string, startIndex = 0): string | null => {
  const normalized = value.replace(/\s*\[end_turn\]\s*$/i, "").trim();
  const start = normalized.indexOf("{", startIndex);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return normalized.slice(start, index + 1);
      }
    }
  }

  return null;
};

const extractStructuredTextFallback = (message: string): string | null => {
  let searchFrom = 0;
  while (true) {
    const candidate = extractTopLevelJsonObject(message, searchFrom);
    if (!candidate) {
      return null;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (record.type === "text" && typeof record.text === "string") {
          return record.text;
        }
      }
    } catch {
      // Keep scanning later brace-delimited objects.
    }

    const nextSearchStart = message.indexOf(candidate, searchFrom);
    if (nextSearchStart < 0) {
      return null;
    }
    searchFrom = nextSearchStart + candidate.length;
  }
};

export const parseAssistantMessage = (
  message: string,
): Array<{ type: "result.text"; text: string }> => {
  const parsed = parseJsonPayload(message);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      return [{ type: "result.text", text: record.text }];
    }
  }

  const fallbackText = extractStructuredTextFallback(message);
  if (fallbackText != null) {
    return [{ type: "result.text", text: fallbackText }];
  }

  return [{ type: "result.text", text: message.trim() }];
};
