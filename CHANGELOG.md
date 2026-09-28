# Changelog

## 0.4.1

- Add correlated native event delivery and replay suppression to `AnteProtocolClient` for host adapters, retaining transport injection.
- Validate complete native questions and replies, and reject duplicate or expired replies.
- Add per-tool approval decisions and expose background `TaskEnd` notifications.
- Question replies now require a live pending question.


## 0.4.0

- Expose every current `Op` and `Evt` in Ante's `protocol-shape/msg.rs`: shell input/output, structured questions and replies, slash commands, local providers, context reports, goals, ambient hints, grouped info blocks, tool updates, session-end details, and all start/resume/update session fields.
- `Query` exposes convenience operations during its single-turn lifetime; use `AnteClient` for multi-turn goals and other long-lived integrations. `SDKMessage` carries structured rather than flattened payloads for the newly supported event families.
- Correct `allowedTools` to use the daemon's exact `tools` replacement field; `allowedTools: []` now truly disables all tools. Add `includeTools` for the additive `include_tools` field. Previous SDK versions incorrectly treated `include_tools` as a whitelist.
- `npm run check:protocol` no longer has an allowlist: any upstream `Op` or `Evt` name missing from the SDK is a failure.

## 0.3.0

Re-verified against ante-preview's `protocol-shape` crate at `0.preview.91` (the SDK's last verification pass was `0.preview.56`, a 35-release gap). Highest-severity finding: `ApprovalResponse` was sending a wire shape the daemon cannot deserialize, so every approval response was silently failing.

- **Fix `ApprovalResponse` wire encoding (breaking bug fix):** `responses` now sends `Array<{ tool_use_id, decision, message? }>`, matching the daemon's `ToolDecision` struct, instead of `Array<[id, decision]>` tuples the daemon's `Vec<ToolDecision>` deserializer rejects. `AnteClient.respondToApproval()` and `buildApprovalResponseOperation()` gain an optional `message` parameter (`ToolDecision.message`, denial feedback returned to the agent).
- **Fix `ApprovalDecision` (breaking type change):** add `"Deny"` (the actual `ReviewDecision` variant used to reject a tool call — previously unrepresentable); drop `"Abort"` (removed from the wire in `v0.preview.85`; "deny and stop" now composes as a deny plus an interrupt) and `"Skip"` (never a real protocol value).
- **Fix `SessionEnd` closing the client on every `ResumeSession` call:** the daemon emits `SessionEnd { reason: "Replaced" }` for the *previous* session whenever a new/resumed session takes over — this is not terminal. The client now only tears down the transport on `reason: "Shutdown"`.
- **Fix `ToolCall.isError`:** it read a nonexistent `is_error` wire field (always `false`). Now derived from `status !== "Completed"`, matching the daemon's own `ToolEndStatus::is_error()` semantics (`Cancelled`/`Denied`/`Failed` are errors).
- Add `AnteClient.sendSteer()` and `Query.steer()` for Ante's native `Steer` operation without replacing the active input operation used to correlate its streamed events and `TurnEnd`.
- Add `Op::Compact` (`AnteClient.compact(instructions?)`) with the current struct-variant shape (`{ Compact: { instructions? } }`) — a bare `"Compact"` string has been rejected by the daemon since `v0.preview.90`.
- Handle `Evt::SessionUpdated` (mid-session `UpdateSession` confirmation, previously silently dropped — local state could diverge from the daemon's) and `Evt::TurnResume` (new `SDKMessage` `{ type: "turn", phase: "resume" }`, closing the pause bracket opened by `TurnPause`/the `approval` message).
- Mark `ProviderSpec.preferredModels` `@deprecated`: the daemon stopped sending `preferred_models` in `v0.preview.75`, so it always resolves to `[]` against a current daemon.
- Add `scripts/check-protocol-drift.mjs` (`npm run check:protocol`) and the project-level `$ante-sdk-protocol-alignment` skill. The checker reports every daemon Op/Evt variant not covered by the SDK.

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
