import type {
  AntePermissionMode,
  ApprovalDecision,
  GoalCommand,
  ProtocolModelSpec,
  QuestionReply,
  ReasoningEffort,
} from "../types.js";

export interface AnteEventEnvelope {
  event?: unknown;
  parent?: string;
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
    return JSON.parse(raw) as AnteEventEnvelope;
  } catch {
    return null;
  }
};
