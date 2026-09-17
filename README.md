# @antigma/ante-sdk

TypeScript SDK for launching Ante, managing sessions, and streaming protocol messages from Node.js applications.

The SDK is intentionally small: it owns the Ante process or websocket transport, serializes protocol operations, parses event envelopes, and exposes a Claude Code SDK-style `query()` API plus a lower-level session client for UI integrations.

## Installation

```bash
npm install @antigma/ante-sdk
```

## Requirements

- Node.js 20 or newer.
- An `ante` executable available on `PATH`, or an explicit `pathToAnteExecutable` option.
- An Ante runtime that supports `ante serve --stdio` or websocket transport **and speaks the current [Protocol Reference](https://docs.antigma.ai/reference/protocol-reference)** — since `0.2.0` the SDK sends `permission_mode`, not the removed `policy` field. Older `ante` builds that only understand `policy` are not supported.

## Quick Start

```ts
import { query } from "@antigma/ante-sdk";

const stream = query({
  prompt: "Summarize this repository.",
  options: {
    cwd: process.cwd(),
    pathToAnteExecutable: "ante",
    provider: "openai-subscription",
    model: "gpt-5.4",
    permissionMode: "default"
  }
});

for await (const message of stream) {
  if (message.type === "stream_event" && message.event.type === "text_delta") {
    process.stdout.write(message.event.text);
  }

  if (message.type === "result" && message.subtype === "error") {
    console.error(message.error);
  }
}
```

## Low-Level Client

Use `createAnteClient()` when the host application needs explicit session lifecycle control, approvals, cancellation, diagnostics, or resume support.

```ts
import { createAnteClient } from "@antigma/ante-sdk";

const client = createAnteClient({
  cwd: process.cwd(),
  pathToAnteExecutable: "ante",
  provider: "openai-subscription",
  model: "gpt-5.4",
  permissionMode: "default"
});

client.setMessageHandler((message) => {
  if (message.type === "approval") {
    client.respondToApproval(message.approval, "Accept");
    return;
  }

  console.log(message);
});

client.setDoneHandler((result) => {
  console.log("turn finished", result);
});

await client.connect();
const sessionId = await client.startSession();
client.sendUserInput(`Continue in session ${sessionId}.`);
```

While that turn is active, send live guidance without starting a new turn:

```ts
client.sendSteer("also update the tests");
```

## Transports

By default, the SDK starts Ante with stdio:

```ts
createAnteClient({
  pathToAnteExecutable: "ante",
  anteArgs: ["serve", "--stdio"]
});
```

For websocket-backed hosts, set `transport` and websocket options:

```ts
createAnteClient({
  transport: "websocket",
  pathToAnteExecutable: "ante",
  websocket: {
    host: "127.0.0.1",
    port: 0
  }
});
```

## Message Shape

The SDK emits typed `SDKMessage` objects. Common messages include:

- `system/init` when a session starts or resumes.
- `stream_event/text_delta` for assistant text.
- `stream_event/thinking_delta` for thinking updates.
- `turn/start` when Ante starts a user turn.
- `tool/start` and `tool/end` for tool execution.
- `approval` when the host must approve or deny a tool call.
- `result/success`, `result/error`, or `result/cancelled` when a turn completes.
- `usage` for model usage metadata.
- `system/diagnostic` for stderr/stdout diagnostics.
- `extensions` for skills, sub-agents, and MCP servers (with their discovered tools) as the daemon refreshes them — fired once right after session start and again once MCP warm-up completes in the background.

## Model Effort and Live Updates

```ts
const client = createAnteClient({
  cwd: process.cwd(),
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  permissionMode: "bypassPermissions", // maps to Ante's native "yolo"
  effort: "high",                      // min | low | medium | high | xhigh | max
  // Lean sessions (selection actions, one-shots):
  shortPrompt: true,                   // compact system prompt + smaller tool descriptions
  noSkills: true,                      // skip skill discovery for this session
  enableAutoMemory: false,
  // Forward a brand-new daemon SessionOverrides field before the SDK types it:
  // sessionExtras: { some_new_flag: true },
});

await client.connect();
await client.startSession();

// Switch model/effort/permission mode without restarting the session.
client.updateSession({ model: "gpt-5.4", effort: "medium", permissionMode: "acceptEdits" });
```

`Options.permissionMode` keeps its existing six-value vocabulary (`default` / `acceptEdits` / `bypassPermissions` / `plan` / `dontAsk` / `auto`) for backward compatibility with existing callers, but only three of those have a native Ante equivalent: `bypassPermissions` → `yolo`, `acceptEdits`/`auto` → `auto`, everything else → `strict` (always ask).

## Public API

```ts
import {
  query,
  createAnteClient,
  AnteProtocolClient,
  AnteStdioTransport,
  AnteWebSocketTransport,
  buildApprovalResponseOperation,
  describeAutoApprovedTools
} from "@antigma/ante-sdk";

import type {
  AnteClient,
  ApprovalDecision,
  ApprovalRequest,
  Options,
  SDKMessage,
  ToolCall
} from "@antigma/ante-sdk";
```

The package is ESM-only and publishes compiled JavaScript plus declaration files from `dist/`.

## Development

```bash
npm install
npm run check
```

Useful individual commands:

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## Versioning

Patch releases keep the public import path stable and may add new message variants or parser support. Breaking API changes should wait for a minor or major version depending on the size of the change. `0.2.0` changed the wire-level `permission_mode` field (see `CHANGELOG.md`) — the TypeScript-facing API is unchanged, but it requires an `ante` build that speaks the current Protocol Reference.

## Release

1. Update `CHANGELOG.md`.
2. Run `npm run check`.
3. Run `npm pack --dry-run` and inspect the file list.
4. Publish with `npm publish --access public`.

## License

MIT
