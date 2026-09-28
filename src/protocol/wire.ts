import type {
  AntePermissionMode,
  ApprovalDecision,
  GoalCommand,
  ProtocolModelSpec,
  QuestionReply,
  ReasoningEffort,
} from "../types.js";

export interface AnteEventEnvelope {
  event: string | Record<string, unknown>;
  parent?: string | null;
  id?: string;
  timestamp?: string;
}

// Field names follow the daemon's `SessionOverrides` struct
// (crates/protocol-shape in ante-preview; docs.antigma.ai/reference/protocol-reference).
// The daemon ignores unknown fields rather than rejecting them, so a wrong
// name here fails silently — verify against a live daemon when changing.
//
// `StartSession` is intentionally an open object (`& Record<string, unknown>`):
// first-class keys cover the known SessionOverrides surface, while
// `Options.sessionExtras` can forward newly-added daemon fields before the SDK
// grows a typed option for them.
export type StartSessionPayload = {
  model?: string;
  provider?: string;
  effort?: ReasoningEffort;
  permission_mode?: AntePermissionMode;
  system_prompt?: string;
  append_system_prompt?: string;
  include_tools?: string[];
  exclude_tools?: string[];
  cwd?: string;
  enable_auto_memory?: boolean;
  short_prompt?: boolean;
  no_skills?: boolean;
  tools?: string[];
  include_skills?: string[];
  exclude_skills?: string[];
  save_session?: boolean;
  unattended?: boolean;
  title?: string;
} & Record<string, unknown>;

export type AnteOperation =
  | {
      StartSession: StartSessionPayload;
    }
  | {
      ResumeSession: {
        session_id: string;
        unattended?: boolean;
      };
    }
  | {
      UpdateSession: {
        model?: ProtocolModelSpec;
        permission_mode?: AntePermissionMode;
        title?: string;
      };
    }
  | {
      UserInput: string;
    }
  | {
      ShellInput: string;
    }
  | {
      Steer: string;
    }
  | {
      QuestionResponse: {
        turn_id: string;
        tool_use_id: string;
        reply: QuestionReply;
      };
    }
  | {
      SlashCommand: {
        name: string;
        args: string;
      };
    }
  | {
      RegisterLocalProvider: {
        port: number;
        model?: ProtocolModelSpec;
      };
    }
  | "RestoreLocalProvider"
  | {
      // Struct variant since ante v0.preview.90 — a bare `"Compact"` string
      // is rejected by daemons at or after that release.
      Compact: {
        instructions?: string;
      };
    }
  | "ContextReport"
  | {
      Goal: GoalCommand;
    }
  | {
      AmbientPhrase: {
        draft: string;
        req_id: number;
      };
    }
  | {
      AmbientSuggestion: {
        recent_user: string;
        recent_agent: string;
        req_id: number;
      };
    }
  | {
      // Matches the daemon's `ToolDecision` struct (protocol-shape/src/msg.rs):
      // an object per tool call, not a `[id, decision]` tuple.
      ApprovalResponse: {
        turn_id: string;
        responses: Array<{
          tool_use_id: string;
          decision: ApprovalDecision;
          message?: string;
        }>;
      };
    }
  | "Interrupt"
  | "Shutdown";

const generateUlid = (): string => {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let timestamp = Date.now();
  let result = "";
  for (let index = 0; index < 10; index += 1) {
    result = alphabet[timestamp % 32] + result;
    timestamp = Math.floor(timestamp / 32);
  }
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  for (let index = 0; index < randomBytes.length; index += 1) {
    result += alphabet[randomBytes[index] % 32];
  }
  return result;
};

export const generateOpId = (): string => `op_${generateUlid()}`;

export const serializeOperation = (op: AnteOperation, id = generateOpId()): string =>
  JSON.stringify({ op, id });

export const parseEnvelope = (raw: string): AnteEventEnvelope | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const envelope = value as Record<string, unknown>;
    const event = envelope.event;
    if (typeof event !== "string" && (!event || typeof event !== "object" || Array.isArray(event))) return null;
    if (envelope.parent != null && typeof envelope.parent !== "string") return null;
    if (envelope.id !== undefined && typeof envelope.id !== "string") return null;
    if (envelope.timestamp !== undefined && typeof envelope.timestamp !== "string") return null;
    return { event: event as string | Record<string, unknown>,
      ...(envelope.parent === null || typeof envelope.parent === "string" ? { parent: envelope.parent } : {}),
      ...(typeof envelope.id === "string" ? { id: envelope.id } : {}),
      ...(typeof envelope.timestamp === "string" ? { timestamp: envelope.timestamp } : {}),
    };
  } catch {
    return null;
  }
};
