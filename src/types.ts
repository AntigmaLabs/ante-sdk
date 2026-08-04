export const ANTE_THINKING_LEVELS = ["Disabled", "Enabled", "Deep", "Max"] as const;

/**
 * @deprecated Ante's daemon replaced the four-level thinking toggle with a
 * six-level `effort` scale (see {@link ReasoningEffort}). This type is kept
 * for backward compatibility with existing `Options.thinking` callers.
 */
export type AnteThinkingLevel = (typeof ANTE_THINKING_LEVELS)[number];

export const REASONING_EFFORTS = ["min", "low", "medium", "high", "xhigh", "max"] as const;

/** Ante's unified six-level model effort scale (protocol `SessionConfig.effort`). */
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "auto";

/** Ante's native tool-approval policy (protocol `SessionConfig.permission_mode`). */
export type AntePermissionMode = "strict" | "auto" | "yolo";

export type ApprovalDecision = "Accept" | "AcceptForSession" | "AcceptAlways" | "Skip" | "Abort";

export interface ApprovalTool {
  id: string;
  name: string;
  argsText?: string;
}

export interface ApprovalRequest {
  turnId: string;
  message: string;
  tools: ApprovalTool[];
}

export interface ToolCall {
  id: string;
  name: string;
  argsText?: string;
  resultText?: string;
  status?: string;
  isError?: boolean;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  raw?: unknown;
}

export interface ModelSpec {
  name: string;
  description?: string;
  thinking?: AnteThinkingLevel | (string & {});
}

export interface ProviderSpec {
  name: string;
  displayName?: string;
  baseUrl?: string;
  preferredModels: ModelSpec[];
}

export interface ProcessStep {
  id: string;
  label: string;
  activeLabel?: string;
  status: "pending" | "in_progress" | "completed";
}

export interface ProcessLane {
  phase: "planning" | "running" | "paused";
  label: string;
  toolName?: string;
  steps: ProcessStep[];
}

export interface SkillInfo {
  name: string;
  description?: string;
  scope?: string;
  argumentHint?: string;
}

export interface SubagentInfo {
  name: string;
  description?: string;
  scope?: string;
}

export interface McpToolParameter {
  name: string;
  paramType?: string;
  required?: boolean;
  description?: string;
}

export interface McpToolInfo {
  name: string;
  qualifiedName?: string;
  description?: string;
  parameters: McpToolParameter[];
}

export interface McpServerInfo {
  name: string;
  command?: string;
  args?: string[];
  tools: McpToolInfo[];
}

export type SDKUserMessage = {
  type: "user";
  message: string;
};

export type SDKMessage =
  | {
      type: "system";
      subtype: "init";
      session_id: string;
      cwd: string;
      model: string;
      provider: string;
      permissionMode: PermissionMode;
      modelSpec?: ModelSpec;
      providerSpec?: ProviderSpec;
    }
  | {
      type: "assistant";
      message: { content: Array<{ type: "text"; text: string }> };
      session_id?: string;
    }
  | {
      type: "stream_event";
      event: { type: "text_delta" | "thinking_delta"; text: string };
      session_id?: string;
    }
  | { type: "turn"; phase: "start"; turnId?: string; session_id?: string }
  | { type: "tool"; phase: "start" | "end"; tool: ToolCall; session_id?: string }
  | { type: "approval"; approval: ApprovalRequest; session_id?: string }
  | { type: "usage"; usage: Usage; session_id?: string }
  | { type: "system"; subtype: "status"; status: "compacting" | null; session_id?: string }
  | {
      type: "system";
      subtype: "diagnostic";
      stream: "stdout" | "stderr" | "system";
      text: string;
      session_id?: string;
    }
  | {
      type: "result";
      subtype: "success" | "error" | "cancelled";
      result?: string;
      error?: string;
      session_id?: string;
    }
  | {
      type: "extensions";
      skills: SkillInfo[];
      subagents: SubagentInfo[];
      mcpServers: McpServerInfo[];
      session_id?: string;
    };

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    toolUseID: string;
  },
) => Promise<{ behavior: "allow" | "deny"; message?: string }>;

/**
 * Forward-compatible bag of extra `StartSession` / `SessionOverrides` wire
 * fields. Keys must already be the daemon's snake_case names
 * (e.g. `{ "short_prompt": true }`). Prefer the first-class camelCase
 * `Options` fields when one exists; those always win on key collisions so
 * callers cannot bypass SDK mappings for `permission_mode`, tool filters, etc.
 *
 * The daemon ignores unknown fields, so new protocol knobs can ship here
 * before the SDK grows a typed option for them.
 */
export type SessionExtras = Record<string, unknown>;

export interface Options {
  abortController?: AbortController;
  allowedTools?: string[];
  anteArgs?: string[];
  canUseTool?: CanUseTool;
  continue?: boolean;
  cwd?: string;
  disallowedTools?: string[];
  effort?: ReasoningEffort;
  /** Whether the agent records/recalls auto-memory (`enable_auto_memory`). */
  enableAutoMemory?: boolean;
  env?: Record<string, string | undefined>;
  model?: string;
  /**
   * Skip skill discovery for this session (`no_skills`). Skills are neither
   * advertised in the system prompt nor invocable. Safe to set even on
   * daemons that have not yet documented the field — unknown keys are ignored.
   */
  noSkills?: boolean;
  pathToAnteExecutable?: string;
  permissionMode?: PermissionMode;
  provider?: string;
  resume?: string;
  /**
   * Escape hatch for new `SessionOverrides` fields the SDK has not yet given
   * a first-class option. See {@link SessionExtras}.
   */
  sessionExtras?: SessionExtras;
  /**
   * Use Ante's compact prompt set (`short_prompt`): condensed system prompt
   * and smaller built-in tool descriptions. Cuts several thousand tokens of
   * fixed tool-schema overhead per turn — useful for short-lived sessions
   * (selection actions, one-shot headless calls).
   */
  shortPrompt?: boolean;
  stderr?: (data: string) => void;
  systemPrompt?: string | { type: "preset"; preset: "ante"; append?: string };
  appendSystemPrompt?: string;
  /** @deprecated Use `effort` instead; Ante's daemon now unifies thinking control into a six-level effort scale. */
  thinking?: AnteThinkingLevel | { type: "disabled" | "enabled" | "deep" | "max" } | null;
  transport?: "stdio" | "websocket";
  wsAddress?: string;
}

export interface SessionUpdate {
  model?: string;
  effort?: ReasoningEffort;
  permissionMode?: PermissionMode;
}

export interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  close(): void;
}
