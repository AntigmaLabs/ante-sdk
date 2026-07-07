# Compatibility Notes

This repository consolidates the SDK variants that previously existed across Ante repositories.

## Source Comparison

| Repository | SDK status before consolidation | Important differences |
| --- | --- | --- |
| `ante-remote` | Consumes `@antigma/ante-sdk@^0.1.0` from npm. | No local SDK source. Lockfile resolves to the initial `0.1.0` package. |
| `ante-obsidian` | Contains `packages/ante-sdk` as a workspace package. | Adds `ToolUpdate` tolerance and a clear stdio disconnected-send error. Uses the old embedded repository metadata. |
| `ante-desktop` | Contains `packages/ante-sdk` as a workspace package. | Adds ESM `.js` source specifiers, `Thinking` and `TurnStart` handling, richer `TurnEnd` error extraction, empty tool-filter omission, turn state reset, and extra tests. |

## Selected Baseline

The standalone SDK uses `ante-desktop` as the baseline because it matches the shape needed by a published ESM package and contains the broader session/event compatibility work. It also merges the two small `ante-obsidian` fixes:

- Ignore `ToolUpdate` events.
- Throw `Ante stdio transport is not connected` if `send()` is called before connect.

## Version Choice

`0.1.0` is already published on npm, so this repository starts at `0.1.1`. The changes are compatible for existing consumers:

- Public package name remains `@antigma/ante-sdk`.
- Main import remains `import { query, createAnteClient } from "@antigma/ante-sdk"`.
- Existing message variants remain valid.
- New message variants are additive.

Consumers should depend on `^0.1.1` after this version is published. Until then, `^0.1.0` resolves to the already-published package.

## Consumer Convention

Ante applications should consume the package from npm instead of embedding `packages/ante-sdk`:

```json
{
  "dependencies": {
    "@antigma/ante-sdk": "^0.1.1"
  }
}
```

Build scripts should not run `npm run build -w @antigma/ante-sdk`. The consuming app should import the package normally and let TypeScript/Vite/esbuild resolve it from `node_modules`.
