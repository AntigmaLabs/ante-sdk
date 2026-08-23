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

test("startSession omits tool filters when the caller did not set them", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider" },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.equal(Object.prototype.hasOwnProperty.call(payload, "include_tools"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "exclude_tools"), false);
});

test("startSession sends an explicit empty include_tools whitelist when allowedTools is []", () => {
  // Callers that want "no tools" (headless one-shots, selection translate/explain)
  // pass allowedTools: []. That must reach the wire as include_tools: [] — omitting
  // the field would leave the daemon's full default toolset enabled.
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider", allowedTools: [] },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.deepEqual(payload.include_tools, []);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "exclude_tools"), false);
});

test("startSession sends tool filters under the daemon's include/exclude field names", () => {
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

  assert.deepEqual(payload.include_tools, ["WebFetch"]);
  assert.deepEqual(payload.exclude_tools, ["Write"]);
  // The daemon never parsed these names; they must not be sent.
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "allowed_tools"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "disallowed_tools"), false);
});

test("startSession no longer sends the removed streaming/thinking/policy fields", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider", thinking: "Deep" },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.equal(Object.prototype.hasOwnProperty.call(payload, "streaming"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "thinking"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "policy"), false);
});

test("legacy thinking maps onto effort when effort is not set", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider", thinking: "Deep" },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  assert.equal(startSessionPayload(transport).effort, "high");

  const explicitTransport = new FakeTransport();
  new AnteProtocolClient(
    { model: "model", provider: "provider", thinking: "Deep", effort: "low" },
    (_options: ResolvedOptions) => explicitTransport,
  )
    .startSession()
    .catch(() => {});
  // An explicit effort wins over the deprecated thinking mapping.
  assert.equal(startSessionPayload(explicitTransport).effort, "low");
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

test("sendSteer preserves the active turn operation and its TurnEnd", async () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider" },
    (_options: ResolvedOptions) => transport,
  );
  const messages: unknown[] = [];
  client.setMessageHandler((message) => messages.push(message));
  await client.connect();

  client.sendUserInput("make a video");
  const inputId = (JSON.parse(transport.sent[0] ?? "{}") as { id?: string }).id;
  client.sendSteer("use ffmpeg if needed");

  const steerEnvelope = JSON.parse(transport.sent[1] ?? "{}") as {
    op?: unknown;
  };
  assert.deepEqual(steerEnvelope.op, { Steer: "use ffmpeg if needed" });

  transport.emit({ MessageDelta: { text: "done" } }, inputId);
  transport.emit({ TurnEnd: { turn_id: "turn_test", status: "Completed" } }, inputId);

  assert.deepEqual(messages, [
    {
      type: "stream_event",
      event: { type: "text_delta", text: "done" },
      session_id: undefined,
    },
    {
      type: "result",
      subtype: "success",
      result: "done",
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

test("startSession sends Ante's native permission_mode instead of the deprecated policy field", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider", permissionMode: "bypassPermissions" },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.equal(payload.permission_mode, "yolo");
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "policy"), false);
});

test("startSession maps acceptEdits to auto and default to strict", () => {
  const acceptEditsTransport = new FakeTransport();
  new AnteProtocolClient(
    { model: "model", provider: "provider", permissionMode: "acceptEdits" },
    (_options: ResolvedOptions) => acceptEditsTransport,
  )
    .startSession()
    .catch(() => {});
  assert.equal(startSessionPayload(acceptEditsTransport).permission_mode, "auto");

  const defaultTransport = new FakeTransport();
  new AnteProtocolClient(
    { model: "model", provider: "provider" },
    (_options: ResolvedOptions) => defaultTransport,
  )
    .startSession()
    .catch(() => {});
  assert.equal(startSessionPayload(defaultTransport).permission_mode, "strict");
});

test("startSession forwards effort when provided", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider", effort: "high" },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.equal(payload.effort, "high");
});

test("startSession forwards shortPrompt, noSkills, and enableAutoMemory", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    {
      model: "model",
      provider: "provider",
      shortPrompt: true,
      noSkills: true,
      enableAutoMemory: false,
    },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.equal(payload.short_prompt, true);
  assert.equal(payload.no_skills, true);
  assert.equal(payload.enable_auto_memory, false);
});

test("startSession omits unset shortPrompt/noSkills rather than sending false", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider" },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.equal(Object.prototype.hasOwnProperty.call(payload, "short_prompt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "no_skills"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "enable_auto_memory"), false);
});

test("sessionExtras are forwarded on StartSession under daemon snake_case keys", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    {
      model: "model",
      provider: "provider",
      sessionExtras: {
        // Hypothetical future SessionOverrides field.
        some_new_daemon_flag: true,
        nested: { a: 1 },
      },
    },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.equal(payload.some_new_daemon_flag, true);
  assert.deepEqual(payload.nested, { a: 1 });
});

test("first-class Options win over colliding sessionExtras keys", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    {
      model: "model",
      provider: "provider",
      shortPrompt: true,
      permissionMode: "bypassPermissions",
      allowedTools: ["WebSearch"],
      sessionExtras: {
        // Reserved keys must not override the typed mapping.
        short_prompt: false,
        permission_mode: "strict",
        include_tools: ["Bash"],
        allowed_tools: ["Write"],
        policy: "Deny",
        // Non-reserved extras still pass through.
        future_knob: "on",
      },
    },
    (_options: ResolvedOptions) => transport,
  );

  client.startSession().catch(() => {});
  const payload = startSessionPayload(transport);

  assert.equal(payload.short_prompt, true);
  assert.equal(payload.permission_mode, "yolo");
  assert.deepEqual(payload.include_tools, ["WebSearch"]);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "allowed_tools"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "policy"), false);
  assert.equal(payload.future_knob, "on");
});

test("updateSession sends model id and mapped permission_mode", () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider" },
    (_options: ResolvedOptions) => transport,
  );

  client.updateSession({ model: "gpt-5.4", effort: "low", permissionMode: "bypassPermissions" });
  const envelope = JSON.parse(transport.sent[0] ?? "{}") as {
    op?: { UpdateSession?: Record<string, unknown> };
  };

  assert.deepEqual(envelope.op?.UpdateSession, {
    model: { id: "gpt-5.4", effort: "low" },
    permission_mode: "yolo",
  });
});

test("emits an extensions message for ExtensionRefreshed events", async () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider" },
    (_options: ResolvedOptions) => transport,
  );
  const messages: unknown[] = [];
  client.setMessageHandler((message) => messages.push(message));
  await client.connect();

  transport.emit({
    ExtensionRefreshed: {
      session_id: "ses_test",
      skills: [{ name: "commit", description: "Create a git commit", scope: "user" }],
      subagents: [],
      mcp_servers: [],
    },
  });

  assert.deepEqual(messages, [
    {
      type: "extensions",
      skills: [{ name: "commit", description: "Create a git commit", scope: "user", argumentHint: undefined }],
      subagents: [],
      mcpServers: [],
      session_id: undefined,
    },
  ]);
});

test("does not drop a late ExtensionRefreshed (MCP warm-up) during an active turn", async () => {
  const transport = new FakeTransport();
  const client = new AnteProtocolClient(
    { model: "model", provider: "provider" },
    (_options: ResolvedOptions) => transport,
  );
  const messages: unknown[] = [];
  client.setMessageHandler((message) => messages.push(message));
  await client.connect();

  // Simulate an in-flight turn (activeInputOpId is set) before the
  // background MCP warm-up event arrives with an unrelated/absent parent.
  client.sendUserInput("hello");
  transport.emit({
    ExtensionRefreshed: {
      skills: [],
      subagents: [],
      mcp_servers: [{ name: "filesystem", tools: [] }],
    },
  });

  const extensionMessages = messages.filter(
    (message): message is { type: "extensions" } =>
      typeof message === "object" && message !== null && (message as { type?: string }).type === "extensions",
  );
  assert.equal(extensionMessages.length, 1);
});
