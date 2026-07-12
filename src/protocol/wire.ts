import type { AntePermissionMode, ApprovalDecision, ReasoningEffort } from "../types.js";

export interface AnteEventEnvelope {
  event?: unknown;
  parent?: string;
}

// Field names follow the daemon's `SessionOverrides` struct exactly
// (crates/protocol-shape in ante-preview; docs.antigma.ai/reference/protocol-reference).
// The daemon ignores unknown fields rather than rejecting them, so a wrong
// name here fails silently — verify against a live daemon when changing.
export type AnteOperation =
  | {
      StartSession: {
        model: string;
        provider: string;
        effort?: ReasoningEffort;
        permission_mode?: AntePermissionMode;
        system_prompt?: string;
        append_system_prompt?: string;
        include_tools?: string[];
        exclude_tools?: string[];
        cwd?: string;
        enable_auto_memory?: boolean;
      };
    }
  | {
      ResumeSession: {
        session_id: string;
      };
    }
  | {
      UpdateSession: {
        model?: {
          id: string;
          effort?: ReasoningEffort;
        };
        permission_mode?: AntePermissionMode;
      };
    }
  | {
      UserInput: string;
    }
  | {
      ApprovalResponse: {
        turn_id: string;
        responses: Array<[string, ApprovalDecision]>;
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
