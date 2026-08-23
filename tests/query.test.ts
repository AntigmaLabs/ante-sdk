import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/query.js";
import type { AnteClient } from "../src/session/client.js";
import type {
  ApprovalDecision,
  ApprovalRequest,
  Options,
  SDKMessage,
  SDKUserMessage,
  SessionUpdate,
} from "../src/types.js";

class FakeClient implements AnteClient {
  messages: SDKMessage[] = [];
  sentInputs: string[] = [];
  sentSteers: string[] = [];
  startCalls = 0;
  resumeCalls: string[] = [];
  updateCalls: SessionUpdate[] = [];
  private onMessage: (message: SDKMessage) => void = () => {};
  private onDone: (result: {
    status: "completed" | "failed" | "cancelled";
    error?: string;
  }) => void = () => {};
  private sessionResolve: ((sessionId: string) => void) | null = null;

  async connect(): Promise<void> {}

  startSession(): Promise<string> {
    this.startCalls += 1;
    return new Promise((resolve) => {
      this.sessionResolve = resolve;
    });
  }

  resumeSession(sessionId: string): Promise<string> {
    this.resumeCalls.push(sessionId);
    return new Promise((resolve) => {
      this.sessionResolve = resolve;
    });
  }

  updateSession(update: SessionUpdate): void {
    this.updateCalls.push(update);
  }

  sendUserInput(prompt: string): string {
    this.sentInputs.push(prompt);
    return `op_${this.sentInputs.length}`;
  }

  sendSteer(prompt: string): string {
    this.sentSteers.push(prompt);
    return `steer_${this.sentSteers.length}`;
  }

  respondToApproval(_approval: ApprovalRequest, _decision: ApprovalDecision): void {}

  interrupt(): void {}

  shutdown(): void {}

  close(): void {}

  setMessageHandler(handler: (message: SDKMessage) => void): void {
    this.onMessage = handler;
  }

  setDoneHandler(
    handler: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void,
  ): void {
    this.onDone = handler;
  }

  getSessionId(): string | null {
    return null;
  }

  resolveSession(sessionId: string): void {
    this.onMessage({
      type: "system",
      subtype: "init",
      session_id: sessionId,
      cwd: "/tmp",
      model: "model",
      provider: "provider",
      permissionMode: "default",
    });
    this.sessionResolve?.(sessionId);
  }

  complete(): void {
    this.onDone({ status: "completed" });
  }
}

test("query waits for session readiness before sending initial prompt", async () => {
  const client = new FakeClient();
  const query = new __test__.AnteQuery(
    "hello",
    { model: "model", provider: "provider" },
    (_options: Options) => client,
  );

  await Promise.resolve();
  assert.equal(client.startCalls, 1);
  assert.deepEqual(client.sentInputs, []);

  client.resolveSession("ses_1");
  assert.deepEqual(await query.next(), {
    value: {
      type: "system",
      subtype: "init",
      session_id: "ses_1",
      cwd: "/tmp",
      model: "model",
      provider: "provider",
      permissionMode: "default",
    },
    done: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(client.sentInputs, ["hello"]);
  client.complete();
  assert.deepEqual(await query.next(), { value: undefined, done: true });
});

test("setPermissionMode and setModel forward to the client's updateSession", async () => {
  const client = new FakeClient();
  const query = new __test__.AnteQuery(
    "hello",
    { model: "model", provider: "provider" },
    (_options: Options) => client,
  );

  await Promise.resolve();
  client.resolveSession("ses_1");
  await query.next();

  await query.setPermissionMode("bypassPermissions");
  await query.setModel("gpt-5.4");

  assert.deepEqual(client.updateCalls, [
    { permissionMode: "bypassPermissions" },
    { model: "gpt-5.4" },
  ]);
});

test("steer forwards live guidance without sending a new user input", async () => {
  const client = new FakeClient();
  const query = new __test__.AnteQuery(
    "hello",
    { model: "model", provider: "provider" },
    (_options: Options) => client,
  );

  await Promise.resolve();
  client.resolveSession("ses_1");
  await query.next();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(client.sentInputs, ["hello"]);
  await query.steer("also update the tests");

  assert.deepEqual(client.sentSteers, ["also update the tests"]);
  assert.deepEqual(client.sentInputs, ["hello"]);
});

test("query waits for resumed session before streaming input", async () => {
  const client = new FakeClient();
  async function* input(): AsyncIterable<SDKUserMessage> {
    yield { type: "user", message: "follow up" };
  }

  const query = new __test__.AnteQuery(
    input(),
    { model: "model", provider: "provider", resume: "ses_existing" },
    (_options: Options) => client,
  );

  await Promise.resolve();
  assert.deepEqual(client.resumeCalls, ["ses_existing"]);
  assert.deepEqual(client.sentInputs, []);

  client.resolveSession("ses_existing");
  await query.next();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(client.sentInputs, ["follow up"]);
  client.complete();
  assert.deepEqual(await query.next(), { value: undefined, done: true });
});
