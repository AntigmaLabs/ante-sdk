import type {
  AntePermissionMode,
  AnteThinkingLevel,
  Options,
  PermissionMode,
  ReasoningEffort,
  SessionExtras,
} from "../types.js";
import type { StartSessionPayload } from "../protocol/wire.js";

export const DEFAULT_ANTE_ARGS = ["serve", "--stdio"] as const;

/**
 * Wire keys that first-class `Options` fields own. `sessionExtras` entries
 * with these names are dropped so callers cannot bypass SDK mappings
 * (`permission_mode`, tool filter names, effort, …).
 */
export const RESERVED_START_SESSION_KEYS = [
  "model",
  "provider",
  "effort",
  "permission_mode",
  "system_prompt",
  "append_system_prompt",
  "include_tools",
  "exclude_tools",
  "cwd",
  "enable_auto_memory",
  "short_prompt",
  "no_skills",
  "tools",
  "include_skills",
  "exclude_skills",
  "save_session",
  "unattended",
  "title",
  // Legacy / wrong names the SDK used to send — keep them reserved so an
  // extras bag cannot reintroduce them under the old labels.
  "allowed_tools",
  "disallowed_tools",
  "policy",
  "streaming",
  "thinking",
] as const;

export type ReservedStartSessionKey = (typeof RESERVED_START_SESSION_KEYS)[number];

export interface ResolvedOptions {
  abortController: AbortController;
  /**
   * `undefined` = leave the daemon's default toolset alone (field omitted).
   * `[]` = send `tools: []` (explicit empty toolset).
   * Non-empty = replace the default toolset with those tools.
   */
  allowedTools?: string[];
  anteArgs: string[];
  cwd: string;
  /**
   * `undefined` / omitted = no exclude list.
   * Non-empty = send `exclude_tools`.
   * An explicit empty array is treated like omit (excluding nothing).
   */
  disallowedTools?: string[];
  effort?: ReasoningEffort;
  enableAutoMemory?: boolean;
  env: Record<string, string>;
  model: string;
  noSkills?: boolean;
  includeTools?: string[];
  includeSkills?: string[];
  excludeSkills?: string[];
  saveSession?: boolean;
  unattended?: boolean;
  title?: string;
  pathToAnteExecutable: string;
  permissionMode: PermissionMode;
  provider: string;
  resume?: string;
  sessionExtras: SessionExtras;
  shortPrompt?: boolean;
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

/**
 * Maps the removed four-level `thinking` toggle onto the daemon's six-level
 * effort scale, so callers still passing `thinking` keep an equivalent
 * behavior. The daemon itself no longer parses a `thinking` field (verified
 * against ante 0.preview.56: unknown values pass without a deserialize
 * error, i.e. the field is gone, not lenient).
 */
export const thinkingToEffort = (thinking: AnteThinkingLevel | null): ReasoningEffort | undefined => {
  switch (thinking) {
    case "Disabled":
      return "min";
    case "Enabled":
      return "medium";
    case "Deep":
      return "high";
    case "Max":
      return "max";
    default:
      return undefined;
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

const normalizeSessionExtras = (extras: Options["sessionExtras"]): SessionExtras => {
  if (!extras) {
    return {};
  }
  const normalized: SessionExtras = {};
  for (const [key, value] of Object.entries(extras)) {
    if (value === undefined) {
      continue;
    }
    if ((RESERVED_START_SESSION_KEYS as readonly string[]).includes(key)) {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
};

export const resolveOptions = (options: Options = {}): ResolvedOptions => ({
  abortController: options.abortController ?? new AbortController(),
  // Preserve "unset" vs "explicit empty whitelist" — see ResolvedOptions.allowedTools.
  allowedTools: options.allowedTools,
  anteArgs: options.anteArgs ?? [...DEFAULT_ANTE_ARGS],
  cwd: options.cwd ?? process.cwd(),
  disallowedTools: options.disallowedTools,
  effort: options.effort ?? thinkingToEffort(normalizeThinking(options.thinking)),
  enableAutoMemory: options.enableAutoMemory,
  env: normalizeEnv(options.env),
  model: options.model ?? "",
  noSkills: options.noSkills,
  includeTools: options.includeTools,
  includeSkills: options.includeSkills,
  excludeSkills: options.excludeSkills,
  saveSession: options.saveSession,
  unattended: options.unattended,
  title: options.title,
  pathToAnteExecutable: options.pathToAnteExecutable ?? "ante",
  permissionMode: options.permissionMode ?? "default",
  provider: options.provider ?? "",
  resume: options.resume,
  sessionExtras: normalizeSessionExtras(options.sessionExtras),
  shortPrompt: options.shortPrompt,
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
 * Build the daemon's `StartSession` payload from resolved options.
 * First-class fields are always written (when set); `sessionExtras` is
 * merged underneath so typed options win on any key collision that slipped
 * past {@link normalizeSessionExtras}.
 *
 * Tool filters:
 * - `allowedTools` unset → omit `tools` (daemon default toolset)
 * - `allowedTools: []` → send `tools: []` (no tools)
 * - `includeTools` → send `include_tools` (add to daemon defaults)
 * - `disallowedTools` empty/unset → omit `exclude_tools`
 */
export const buildStartSessionPayload = (options: ResolvedOptions): StartSessionPayload => {
  const excludeTools =
    options.disallowedTools && options.disallowedTools.length > 0
      ? options.disallowedTools
      : undefined;
  return {
    ...options.sessionExtras,
    model: options.model.trim() || undefined,
    provider: options.provider.trim() || undefined,
    effort: options.effort,
    permission_mode: permissionModeToAnte(options.permissionMode),
    system_prompt: options.systemPrompt,
    append_system_prompt: options.appendSystemPrompt,
    include_tools: options.includeTools,
    exclude_tools: excludeTools,
    cwd: options.cwd,
    enable_auto_memory: options.enableAutoMemory,
    short_prompt: options.shortPrompt,
    no_skills: options.noSkills,
    tools: options.allowedTools,
    include_skills: options.includeSkills,
    exclude_skills: options.excludeSkills,
    save_session: options.saveSession,
    unattended: options.unattended,
    title: options.title,
  };
};

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
