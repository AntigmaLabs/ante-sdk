# Changelog

## 0.1.1

- Add source-level ESM `.js` import specifiers so built package output works as an ESM dependency.
- Emit `turn/start` messages and support `Thinking` events as `thinking_delta` stream events.
- Omit empty `allowed_tools` and `disallowed_tools` fields from `StartSession` operations.
- Reset turn state after success, failure, and cancellation.
- Improve `TurnEnd` error extraction for `status.Error` and structured details payloads.
- Ignore `ToolUpdate` protocol events that do not require host-side state changes.
- Throw a clear error when stdio sends before the transport is connected.

## 0.1.0

- Initial public npm release from the SDK originally embedded in Ante integrations.
