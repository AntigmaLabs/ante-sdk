# Changelog

## 0.2.3

- Add `AnteClient.sendSteer()` and `Query.steer()` for Ante's native `Steer`
  operation. Steering now adds live guidance to the active turn without
  replacing the input operation used to correlate its streamed events and
  `TurnEnd`.

## 0.2.2

- Add first-class `Options.shortPrompt` → `short_prompt` and `Options.noSkills` → `no_skills` on `StartSession`. Unset values are omitted so the daemon keeps its defaults.
- Add `Options.sessionExtras` as a forward-compatible escape hatch for new `SessionOverrides` wire fields the SDK has not typed yet. Keys must already be the daemon's snake_case names. First-class options always win on collisions; reserved keys (`permission_mode`, `include_tools`, legacy `policy`/`allowed_tools`/…, and the new short-prompt/skills fields) are stripped from the extras bag so callers cannot bypass SDK mappings.
- Export `buildStartSessionPayload`, `StartSessionPayload`, `SessionExtras`, and `RESERVED_START_SESSION_KEYS` for hosts that need to inspect or extend the payload.
- **Tool filter semantics:** `allowedTools` unset still omits `include_tools` (daemon default toolset). Explicit `allowedTools: []` now sends `include_tools: []` so headless/no-tool callers get a real empty whitelist instead of silently inheriting every builtin tool. This matters more after 0.2.0 mapped `dontAsk` → `strict` (no more wire-level Deny).

## 0.2.1

Completes the protocol alignment started in 0.2.0. All fixes verified against a live `ante serve --stdio` (0.preview.56) and the `SessionOverrides` struct in ante-preview's `protocol-shape` crate — the daemon ignores unknown fields, so every one of these was failing silently rather than erroring.

- **Fix tool filters being silently ignored:** `StartSession` now sends `include_tools` / `exclude_tools` (the daemon's actual field names) instead of `allowed_tools` / `disallowed_tools`, which the daemon never parsed. `Options.allowedTools` / `Options.disallowedTools` keep their names; only the wire encoding changed.
- **Stop sending removed fields:** `streaming` and `thinking` are no longer part of the daemon's `SessionOverrides` and are dropped from the wire. The deprecated `Options.thinking` now maps onto `effort` (`Disabled`→`min`, `Enabled`→`medium`, `Deep`→`high`, `Max`→`max`; exported as `thinkingToEffort`) so existing callers keep equivalent behavior. An explicit `Options.effort` wins over the mapping.
- Add `Options.enableAutoMemory` → `enable_auto_memory`, completing the documented `SessionConfig` field set.

## 0.2.0

Brings the SDK back in sync with the current Ante Protocol (verified live against `ante` 0.preview.56 / `ante serve --stdio`; see https://docs.antigma.ai/reference/protocol-reference).

- **Breaking (wire-level only, not source-level):** `StartSession` now sends the daemon's current `permission_mode` (`"strict" | "auto" | "yolo"`) instead of the removed `policy: "Auto" | "Ask" | "Deny"` field. Requires a daemon build that speaks the current protocol; older `ante` builds that only understand `policy` are no longer supported.
  - `permissionModeToPolicy` is replaced by `permissionModeToAnte`. The mapping also fixes a real collision: `bypassPermissions` and `acceptEdits` used to both resolve to the same value; `bypassPermissions` now maps to Ante's `yolo` (matching the CLI's own `--yolo` flag), while `acceptEdits`/`auto` map to `auto`. `plan`/`dontAsk`, which have no native Ante equivalent, resolve to the conservative `strict` (always ask) instead of the previous `Deny`.
- Add `effort` support (`Options.effort`, `ReasoningEffort` type: `min/low/medium/high/xhigh/max`) for Ante's unified six-level model effort scale, sent on both `StartSession` and the new `updateSession()`. The old four-level `thinking` option still works but is now marked `@deprecated`.
- Add `AnteClient.updateSession()` / `Query`'s `setPermissionMode()` and `setModel()` now actually send an `UpdateSession` operation to the daemon — previously they only updated local state and had no effect on the running session.
- Add a new `extensions` `SDKMessage` variant, populated from the daemon's `ExtensionRefreshed` event: discovered skills, sub-agents, and **MCP servers** (with their tool lists) are now observable through the SDK. This event was previously silently dropped.
- Add `AcceptAlways` to `ApprovalDecision`, matching the daemon's `ReviewDecision` (grants approval for the session and persists an allow rule to `settings.json`).
- Fix `extractModelSpec` / `extractProviderSpec`: the daemon reports `{ id, ... }` for models and providers, not `{ name, ... }`. Both extractors silently returned `null` for every live session, so `SDKMessage`'s `system`/`init` message always had `modelSpec: undefined` and `providerSpec: undefined`.

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
