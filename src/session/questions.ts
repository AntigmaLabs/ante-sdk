import type { QuestionReply, QuestionRequest } from "../types.js";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid Ante question ${field}`);
  }
  return value;
};

export function parseQuestionPause(value: unknown): QuestionRequest | null {
  if (!record(value) || !record(value.reason) || !("Question" in value.reason)) return null;
  const question = value.reason.Question;
  if (!record(question) || !Array.isArray(question.questions) || question.questions.length === 0) {
    throw new Error("Invalid Ante question payload");
  }
  const turnId = requiredText(value.turn_id, "turn_id");
  const toolUseId = requiredText(question.tool_use_id, "tool_use_id");
  const questions = question.questions.map((entry) => {
    if (!record(entry) || !Array.isArray(entry.options)) throw new Error("Invalid Ante question specification");
    if (entry.multi_select !== undefined && typeof entry.multi_select !== "boolean") {
      throw new Error("Invalid Ante question multi_select");
    }
    const labels = new Set<string>();
    const options = entry.options.map((option) => {
      if (!record(option) || typeof option.description !== "string") {
        throw new Error("Invalid Ante question option");
      }
      const label = requiredText(option.label, "option label");
      if (labels.has(label)) throw new Error("Duplicate Ante question option label");
      labels.add(label);
      if (option.preview != null && typeof option.preview !== "string") throw new Error("Invalid Ante question preview");
      return {
        label,
        description: option.description,
        ...(typeof option.preview === "string" ? { preview: option.preview } : {}),
      };
    });
    return {
      header: requiredText(entry.header, "header"),
      question: requiredText(entry.question, "text"),
      multiSelect: entry.multi_select === true,
      options,
    };
  });
  return { turnId, toolUseId, questions };
}

export function validateQuestionReply(question: QuestionRequest, reply: QuestionReply): void {
  if (reply === "Dismissed") return;
  if (!record(reply)) throw new Error("Invalid Ante question reply");
  if ("Discuss" in reply && Object.keys(reply).length === 1) {
    if (!record(reply.Discuss) || (reply.Discuss.message !== undefined && typeof reply.Discuss.message !== "string")) {
      throw new Error("Invalid Ante question discussion");
    }
    return;
  }
  if (!("Answered" in reply) || !Array.isArray(reply.Answered) || Object.keys(reply).length !== 1 || reply.Answered.length !== question.questions.length) {
    throw new Error("Ante answers must match the original question count and order");
  }
  reply.Answered.forEach((answer, index) => {
    const spec = question.questions[index];
    if (!spec || !record(answer) || !Array.isArray(answer.selected) || answer.selected.some((label) => typeof label !== "string")) {
      throw new Error("Invalid Ante question answer");
    }
    if (answer.note !== undefined && typeof answer.note !== "string") throw new Error("Invalid Ante question note");
    if (!spec.multiSelect && answer.selected.length > 1) throw new Error("Ante single-choice question accepts only one selection");
    if (new Set(answer.selected).size !== answer.selected.length) throw new Error("Duplicate Ante question selection");
    const labels = new Set(spec.options.map((option) => option.label));
    if (answer.selected.some((label) => !labels.has(label))) throw new Error("Unknown Ante question selection");
  });
}
