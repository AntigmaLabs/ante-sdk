import type { AntePermissionMode, AnteThinkingLevel, Options, PermissionMode, ReasoningEffort } from "../types.js";

export const DEFAULT_ANTE_ARGS = ["serve", "--stdio"] as const;

export interface ResolvedOptions {
  abortController: AbortController;
  allowedTools: string[];
  anteArgs: string[];
  cwd: string;
  disallowedTools: string[];
  effort?: ReasoningEffort;
  env: Record<string, string>;
  model: string;
  pathToAnteExecutable: string;
  permissionMode: PermissionMode;
  provider: string;
  resume?: string;
  stderr?: (data: string) => void;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  thinking: AnteThinkingLevel | null;
  transport: "stdio" | "websocket";
  wsAddress: string;
}

const normalizeThinking = (thinking: Options["thinking"]): AnteThinkingLevel | null => {
  if (thinking == null) {
    return null;
  }
  if (typeof thinking === "string") {
    return thinking;
  }
  switch (thinking.type) {
    case "disabled":
      return "Disabled";
    case "enabled":
      return "Enabled";
    case "deep":
      return "Deep";
    case "max":
      return "Max";
    default:
      return null;
  }
};

const normalizeEnv = (env: Options["env"]): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value != null) {
      normalized[key] = value;
    }
  }
  return normalized;
};

export const resolveOptions = (options: Options = {}): ResolvedOptions => ({
  abortController: options.abortController ?? new AbortController(),
  allowedTools: options.allowedTools ?? [],
  anteArgs: options.anteArgs ?? [...DEFAULT_ANTE_ARGS],
  cwd: options.cwd ?? process.cwd(),
  disallowedTools: options.disallowedTools ?? [],
  effort: options.effort,
  env: normalizeEnv(options.env),
  model: options.model ?? "",
  pathToAnteExecutable: options.pathToAnteExecutable ?? "ante",
  permissionMode: options.permissionMode ?? "default",
  provider: options.provider ?? "",
  resume: options.resume,
  stderr: options.stderr,
  systemPrompt: typeof options.systemPrompt === "string" ? options.systemPrompt : undefined,
  appendSystemPrompt:
    options.appendSystemPrompt ??
    (typeof options.systemPrompt === "object" && options.systemPrompt.type === "preset"
      ? options.systemPrompt.append
      : undefined),
  thinking: normalizeThinking(options.thinking),
  transport: options.transport ?? "stdio",
  wsAddress: options.wsAddress ?? "127.0.0.1:17361",
});

/**
 * Maps the SDK's six-value `PermissionMode` (inherited from Claude Code-style
 * consumers) onto Ante's native three-state `permission_mode`
 * (`strict`/`auto`/`yolo` — see `ante --help`'s `--yolo` flag and the
 * Protocol Reference at https://docs.antigma.ai/reference/protocol-reference).
 *
 * `bypassPermissions` and `acceptEdits` used to collapse onto the same
 * deprecated `policy: "Auto"` value, so a caller asking for a full bypass got
 * the same behavior as "auto-accept edits". They are now split: only
 * `bypassPermissions` maps to Ante's `yolo` (skip all approvals), matching
 * the CLI's own `--yolo` semantics.
 *
 * `plan` and `dontAsk` have no native Ante equivalent (Ante has no
 * "plan-only" mode and no persistent "deny everything" policy). They resolve
 * to `strict` — the conservative choice that always asks rather than
 * silently granting or silently rejecting tool calls.
 */
export const permissionModeToAnte = (mode: PermissionMode): AntePermissionMode => {
  switch (mode) {
    case "bypassPermissions":
      return "yolo";
    case "acceptEdits":
    case "auto":
      return "auto";
    default:
      return "strict";
  }
};
