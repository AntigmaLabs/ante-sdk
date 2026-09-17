import type { ApprovalDecision, ApprovalRequest, ProcessLane, ProcessStep } from "../types.js";

export const buildApprovalResponseOperation = (
  approval: ApprovalRequest,
  decision: ApprovalDecision,
  message?: string,
): {
  ApprovalResponse: {
    turn_id: string;
    responses: Array<{ tool_use_id: string; decision: ApprovalDecision; message?: string }>;
  };
} => ({
  ApprovalResponse: {
    turn_id: approval.turnId,
    responses: approval.tools.map((tool) => ({
      tool_use_id: tool.id,
      decision,
      ...(message ? { message } : {}),
    })),
  },
});

export const buildApprovalProcessLane = (
  approval: ApprovalRequest,
  previousSteps?: ProcessStep[],
): ProcessLane => ({
  phase: "paused",
  label: approval.message || "Awaiting tool approval",
  toolName: approval.tools[0]?.name,
  steps: previousSteps ?? [],
});

export const describeAutoApprovedTools = (approval: ApprovalRequest): string =>
  `Ante auto-approved ${approval.tools.map((tool) => tool.name).join(", ") || "tool call"}`;
