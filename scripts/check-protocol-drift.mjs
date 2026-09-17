#!/usr/bin/env node
// Diffs this SDK's wire surface (src/protocol/wire.ts + src/session/client.ts)
// against the daemon's protocol-shape crate (AntigmaLabs/ante,
// crates/protocol-shape/src/msg.rs), fetched straight from GitHub. This is
// so protocol changes in the daemon repo are surfaced mechanically during
// protocol-alignment review instead of by manual re-reading.
//
// Usage:
//   node scripts/check-protocol-drift.mjs [--ref <branch-or-sha>] [--json] [--local <path>]
//
// --ref     Branch/tag/sha in AntigmaLabs/ante to fetch msg.rs from
//           (default: "main", or $ANTE_PROTOCOL_REF).
// --local   Read msg.rs from a local checkout instead of GitHub (offline dev
//           use, e.g. a sibling `ante`/`ante-preview` clone).
// --json    Emit the diff as JSON on stdout instead of a human-readable report.
//
// Exits non-zero when the daemon has Op/Evt variants the SDK doesn't
// send/handle, so it can gate a protocol-alignment review or pre-release
// check. Network/parse
// failures also exit non-zero (fetch is required in the default mode: there
// is nothing useful to report without a source to diff against).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(here, "..");

const REPO = "AntigmaLabs/ante";
const MSG_RS_PATH = "crates/protocol-shape/src/msg.rs";

// These variants are intentionally not exposed by the public SDK yet. Keep
// this baseline explicit: it documents the boundary while ensuring a newly
// added daemon variant still fails CI instead of being silently masked.
const KNOWN_UNSUPPORTED = {
  op: new Set([
    "ShellInput",
    "SlashCommand",
    "QuestionResponse",
    "RegisterLocalProvider",
    "RestoreLocalProvider",
    "ContextReport",
    "Goal",
    "AmbientPhrase",
    "AmbientSuggestion",
  ]),
  evt: new Set([
    "UserInput",
    "ShellOutput",
    "InfoBlockStart",
    "InfoBlockAppend",
    "ContextReport",
    "Ambient",
  ]),
};

function parseArgs(argv) {
  const args = { ref: process.env.ANTE_PROTOCOL_REF ?? "main", json: false, local: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ref") {
      args.ref = argv[++i];
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--local") {
      args.local = argv[++i];
    }
  }
  return args;
}

async function fetchMsgRs(ref) {
  const url = `https://raw.githubusercontent.com/${REPO}/${ref}/${MSG_RS_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`);
  }
  return { source: await response.text(), url };
}

function readLocalMsgRs(localPath) {
  const resolved = path.resolve(localPath);
  const candidates = [resolved, path.join(resolved, MSG_RS_PATH)];
  for (const candidate of candidates) {
    try {
      return { source: readFileSync(candidate, "utf8"), url: candidate };
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Could not find msg.rs under ${localPath} (tried ${candidates.join(", ")})`);
}

// Extracts top-level variant names from `pub enum <name> { ... }` in a Rust
// source file, ignoring nested struct/enum bodies by tracking brace/paren
// depth so e.g. `Compact { instructions: Option<String> }` yields `Compact`,
// not `instructions`.
function extractEnumVariants(source, enumName) {
  const start = source.search(new RegExp(`pub enum ${enumName}\\s*\\{`));
  if (start < 0) {
    throw new Error(`enum ${enumName} not found in source`);
  }
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(braceStart + 1, end);

  const variants = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let current = "";
  let inLineComment = false;
  let awaitingIdentifier = true;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const next = body[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      awaitingIdentifier = false;
      continue;
    }
    if (ch === "}") {
      braceDepth -= 1;
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      awaitingIdentifier = false;
      continue;
    }
    if (ch === ")") {
      parenDepth -= 1;
      continue;
    }
    if (braceDepth > 0 || parenDepth > 0) {
      continue;
    }
    if (ch === "," || ch === ";") {
      if (current.trim()) variants.push(current.trim());
      current = "";
      awaitingIdentifier = true;
      continue;
    }
    if (awaitingIdentifier) {
      if (/[A-Za-z_]/.test(ch)) {
        current += ch;
      } else if (current && /\s/.test(ch)) {
        awaitingIdentifier = false;
      }
    }
  }
  if (current.trim()) variants.push(current.trim());
  return [...new Set(variants.filter(Boolean))];
}

function loadSdkOps() {
  const source = readFileSync(path.join(sdkRoot, "src/protocol/wire.ts"), "utf8");
  const opNames = new Set();
  const unionStart = source.indexOf("export type AnteOperation");
  const unionBody = source.slice(unionStart, source.indexOf("\n\nconst generateUlid"));
  // Each `| { ... }` member's variant key sits at exactly 6-space indent
  // (prettier's formatting for this union) regardless of its value shape
  // (`Foo: string;`, `Foo: { ... };`, etc.); nested fields sit deeper.
  for (const match of unionBody.matchAll(/^ {6}(\w+):/gm)) {
    opNames.add(match[1]);
  }
  for (const match of unionBody.matchAll(/\|\s*"(\w+)"/g)) {
    opNames.add(match[1]);
  }
  return [...opNames];
}

function loadSdkHandledEvents() {
  const source = readFileSync(path.join(sdkRoot, "src/session/client.ts"), "utf8");
  const switchStart = source.indexOf("private handleVariant(name: string");
  const switchBody = source.slice(switchStart, source.indexOf("\n  }", switchStart + 200));
  const names = new Set();
  for (const match of switchBody.matchAll(/case "(\w+)":/g)) {
    names.add(match[1]);
  }
  return [...names];
}

function diff(daemonList, sdkList, knownUnsupported) {
  const sdkSet = new Set(sdkList);
  const daemonSet = new Set(daemonList);
  const missing = daemonList.filter((v) => !sdkSet.has(v));
  return {
    missingInSdk: missing.filter((v) => !knownUnsupported.has(v)),
    knownMissingInSdk: missing.filter((v) => knownUnsupported.has(v)),
    staleInSdk: sdkList.filter((v) => !daemonSet.has(v)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let source;
  let origin;
  try {
    if (args.local) {
      ({ source, url: origin } = readLocalMsgRs(args.local));
    } else {
      ({ source, url: origin } = await fetchMsgRs(args.ref));
    }
  } catch (error) {
    console.error(`[check-protocol-drift] Failed to load msg.rs: ${error.message}`);
    process.exit(2);
  }

  const daemonOps = extractEnumVariants(source, "Op");
  const daemonEvents = extractEnumVariants(source, "Evt");
  const sdkOps = loadSdkOps();
  const sdkEvents = loadSdkHandledEvents();

  const opDiff = diff(daemonOps, sdkOps, KNOWN_UNSUPPORTED.op);
  const eventDiff = diff(daemonEvents, sdkEvents, KNOWN_UNSUPPORTED.evt);
  const hasDrift = opDiff.missingInSdk.length > 0 || eventDiff.missingInSdk.length > 0;

  if (args.json) {
    console.log(JSON.stringify({ source: origin, op: opDiff, evt: eventDiff, hasDrift }, null, 2));
  } else {
    console.log(`Comparing ante-sdk against ${origin}`);
    const report = (title, d) => {
      if (d.missingInSdk.length) {
        console.log(`\n${title}: daemon variants the SDK cannot send/handle:`);
        for (const v of d.missingInSdk) console.log(`  - ${v}`);
      }
      if (d.knownMissingInSdk.length) {
        console.log(`\n${title}: documented unsupported daemon variants:`);
        for (const v of d.knownMissingInSdk) console.log(`  - ${v}`);
      }
      if (d.staleInSdk.length) {
        console.log(`\n${title}: SDK references variants no longer in the daemon (rename/removal?):`);
        for (const v of d.staleInSdk) console.log(`  - ${v}`);
      }
    };
    report("Op", opDiff);
    report("Evt", eventDiff);
    if (!hasDrift) {
      console.log("\nNo unexpected missing operations/events detected. \u2705");
    }
  }

  process.exit(hasDrift ? 1 : 0);
}

main();
