---
name: ante-sdk-protocol-alignment
description: Audit or align this SDK with the Ante Rust protocol when protocol variants, wire shapes, session behavior, or SDK compatibility may have changed. Do not use for ordinary TypeScript-only changes.
---

# Ante SDK protocol alignment

Use this skill when a request changes, reviews, or investigates the protocol boundary between this TypeScript SDK and `AntigmaLabs/ante`.

The Rust `crates/protocol-shape/src/msg.rs` definition is authoritative for wire names and payload shapes. Do not infer semantics from variant names alone.

## Establish the protocol delta

Run `npm run check:protocol` to compare the checked-out SDK with the current upstream default branch. For a reproducible or offline comparison, run `node scripts/check-protocol-drift.mjs --local <ante-checkout>` or pass an explicit `--ref`.

The report fails whenever the daemon has an Op or Evt variant the SDK does not cover. Do not weaken the comparison merely to make a check pass: implement the capability or obtain an explicit decision to leave it unsupported.

## Make an alignment change

Read the complete Rust declaration and follow its payload through the SDK before editing. In particular, assess wire serialization in `src/protocol/wire.ts`, public types in `src/types.ts`, state/lifecycle behavior in `src/session/client.ts`, and higher-level `Query` behavior where relevant.

For a new event, decide whether it must update session state, resolve/reject a pending operation, emit an `SDKMessage`, or remain intentionally unsupported. For a new operation, define the public API and its payload rather than exposing a name-only escape hatch. Preserve unrelated compatibility behavior and update README/changelog claims when the public API changes.

Add focused tests that assert the actual serialized operation or emitted message. Finish with `npm run check` and re-run the protocol check against the intended source ref. Do not commit, push, publish, create an Issue, or change remote automation unless the user explicitly requests it.

## Boundaries

This repository intentionally does not run protocol alignment as an unattended GitHub Action: detected drift needs semantic review before an SDK implementation can be proposed. Treat a protocol report as an engineering review input, not permission to generate code automatically.
