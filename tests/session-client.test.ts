import assert from "node:assert/strict";
import test from "node:test";
import { AnteProtocolClient } from "../src/session/client.js";
import type { ResolvedOptions } from "../src/session/options.js";
import type { AnteTransport } from "../src/transport/transport.js";

class FakeTransport implements AnteTransport {
  sent: string[] = [];
  private messageHandler: (message: string) => void = () => {};

  async connect(): Promise<void> {}

  disconnect(): void {}

  send(message: string): void {
    this.sent.push(message);
  }

  isConnected(): boolean {
    return true;
  }

  setMessageHandler(handler: (message: string) => void): void {
    this.messageHandler = handler;
  }

  setErrorHandler(_handler: (error: Error) => void): void {}

  setCloseHandler(_handler: (info?: { code?: number; reason?: string }) => void): void {}

  setDiagnosticHandler(_handler: (event: { stream: "stdout" | "stderr"; text: string }) => void): void {}

  emit(event: unknown, parent?: string): void {
    this.messageHandler(JSON.stringify({ event, parent }));
  }
}

const startSessionPayload = (transport: FakeTransport): Record<string, unknown> => {
  const envelope = JSON.parse(transport.sent[0] ?? "{}") as {
    op?: { StartSession?: Record<string, unknown> };
  };
  return envelope.op?.StartSession ?? {};
};

test("startSession omits empty tool filters", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider" },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.equal(Object.prototype.hasOwnProperty.call(payload, "allowed_tools"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "disallowed_tools"), false);
});

test("startSession preserves explicit tool filters", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    {
      allowedTools: ["WebFetch"],
      disallowedTools: ["Write"],
      model: "model",
      provider: "provider",
    },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.deepEqual(payload.allowed_tools, ["WebFetch"]);
  assert.deepEqual(payload.disallowed_tools, ["Write"]);
});

test("emits turn start messages for the active input operation", async () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider" },
    (_options: ResolvedOptions) => transport,
  );
  const messages: unknown[] = [];
  client.setMessageHandler((message) => messages.push(message));
  await client.connect();

  client.sendUserInput("hello");
  const inputId = (JSON.parse(transport.sent[0] ?? "{}") as { id?: string }).id;
  transport.emit({ TurnStart: { turn_id: "turn_test" } }, inputId);

  assert.deepEqual(messages, [
    {
      type: "turn",
      phase: "start",
      turnId: "turn_test",
      session_id: undefined,
    },
  ]);
});

test("ignores tool update protocol events", async () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider" },
    (_options: ResolvedOptions) => transport,
  );
  const messages: unknown[] = [];
  client.setMessageHandler((message) => messages.push(message));
  await client.connect();

  client.sendUserInput("hello");
  const inputId = (JSON.parse(transport.sent[0] ?? "{}") as { id?: string }).id;
  transport.emit({ ToolUpdate: { call_id: "tool_test", status: "running" } }, inputId);

  assert.deepEqual(messages, []);
});
