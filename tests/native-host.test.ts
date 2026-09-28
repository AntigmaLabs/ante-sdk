import assert from "node:assert/strict";
import test from "node:test";
import { AnteProtocolClient, parseQuestionPause, validateQuestionReply, type AnteTransport, type AnteEventEnvelope, type SDKMessage } from "../src/index.js";

class Transport implements AnteTransport {
  sent: string[] = [];
  handler: (line: string) => void = () => {};
  onClose: () => void = () => {};
  async connect() {}
  disconnect() {}
  send(line: string) { this.sent.push(line); }
  isConnected() { return true; }
  setMessageHandler(handler: (line: string) => void) { this.handler = handler; }
  setErrorHandler() {}
  setCloseHandler(handler: () => void) { this.onClose = handler; }
  setDiagnosticHandler() {}
  emit(event: unknown, parent?: string) { this.handler(JSON.stringify({ event, parent })); }
}

const pause = {
  turn_id: "step_live",
  reason: { Question: { tool_use_id: "ask_1", questions: [
    { header: "Style", question: "Choose", options: [{ label: "Warm", description: "Soft", preview: "color: orange" }] },
    { header: "Details", question: "Anything else?", multi_select: true, options: [] },
  ] } },
};

test("native questions preserve previews and order and reject malformed entries", () => {
  const question = parseQuestionPause(pause)!;
  assert.equal(question.questions[0]?.options[0]?.preview, "color: orange");
  validateQuestionReply(question, { Answered: [{ selected: ["Warm"], note: "less saturated" }, { selected: [], note: "large text" }] });
  validateQuestionReply(question, "Dismissed");
  validateQuestionReply(question, { Discuss: { message: "Explain the choice" } });
  assert.throws(() => validateQuestionReply(question, { Answered: [{ selected: ["Warm"] }] }), /count/);
  assert.throws(() => validateQuestionReply(question, { Answered: [{ selected: ["Unknown"] }, { selected: [] }] }), /Unknown/);
  assert.throws(() => parseQuestionPause({ ...pause, reason: { Question: { ...pause.reason.Question, questions: [null, ...pause.reason.Question.questions] } } }), /Invalid/);
});

test("pending questions reject duplicate and late responses for all reply variants", async () => {
  const transport = new Transport();
  const client = new AnteProtocolClient({}, () => transport);
  await client.connect();
  for (const reply of ["Dismissed", { Discuss: { message: "Why?" } }, { Answered: [{ selected: ["Warm"] }, { selected: [], note: "hello" }] }] as const) {
    transport.emit({ TurnPause: pause });
    const pending = client.getPendingQuestion("step_live", "ask_1")!;
    client.respondToQuestion(pending, JSON.parse(JSON.stringify(reply)));
    assert.throws(() => client.respondToQuestion(pending, "Dismissed"), /no longer pending/);
  }
  transport.emit({ TurnPause: pause });
  const pending = client.getPendingQuestion("step_live", "ask_1")!;
  transport.emit({ TurnResume: { turn_id: "step_live" } });
  assert.throws(() => client.respondToQuestion(pending, "Dismissed"), /no longer pending/);
  transport.emit({ TurnPause: pause });
  client.interrupt();
  assert.equal(client.getPendingQuestion("step_live", "ask_1"), null);
  transport.emit({ TurnPause: pause });
  transport.onClose();
  assert.equal(client.getPendingQuestion("step_live", "ask_1"), null);
});

test("native host delivery suppresses restored questions and retains live correlation and completion", async () => {
  const transport = new Transport();
  const client = new AnteProtocolClient({}, () => transport);
  const events: AnteEventEnvelope[] = [];
  client.setNativeEventHandler((event) => events.push(event), { suppressReplay: true });
  await client.connect();
  const resumed = client.resumeSession("ses_restored");
  const startup = JSON.parse(transport.sent[0]!).id;
  transport.emit({ SessionStart: { session_id: "ses_restored" } }, startup);
  assert.equal(await resumed, "ses_restored");
  transport.emit({ TurnPause: pause }, "op_history");
  assert.equal(client.getPendingQuestion("step_live", "ask_1"), null);
  const input = client.sendUserInput("continue");
  transport.emit({ TurnStart: { turn_id: "step_live" } }, input);
  transport.emit({ TurnPause: pause }, input);
  client.sendSteer("use warm colors");
  transport.emit({ Thinking: "finished thought" }, input);
  transport.emit({ TurnEnd: { turn_id: "step_live", status: "Completed" } }, input);
  assert.equal(events.length, 5);
  assert.equal(events[events.length - 1]?.parent, input);
  assert.deepEqual(events[3]?.event, { Thinking: "finished thought" });
  assert.equal(client.getPendingQuestion("step_live", "ask_1"), null);
});

test("mixed approvals and background completion preserve individual decisions", async () => {
  const transport = new Transport();
  const client = new AnteProtocolClient({}, () => transport);
  const events: SDKMessage[] = [];
  client.setMessageHandler((event) => events.push(event));
  await client.connect();
  client.respondToToolApprovals("step_live", [
    { toolUseId: "read", decision: "Accept" },
    { toolUseId: "write", decision: "Deny", message: "read only" },
  ]);
  assert.deepEqual(JSON.parse(transport.sent[0]!).op.ApprovalResponse.responses, [
    { tool_use_id: "read", decision: "Accept" },
    { tool_use_id: "write", decision: "Deny", message: "read only" },
  ]);
  transport.emit({ TaskEnd: { tool_use_id: "background", exit_code: 7 } });
  assert.deepEqual(events[events.length - 1], { type: "task_end", toolUseId: "background", exitCode: 7, session_id: undefined });
});
