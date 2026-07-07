import assert from "node:assert/strict";
import test from "node:test";
import { AnteStdioTransport } from "../src/transport/stdio.js";

test("stdio transport throws when sending before connect", () => {
  const transport = new AnteStdioTransport({
    command: "ante",
    args: ["serve", "--stdio"],
    cwd: process.cwd(),
    env: {}
  });

  assert.throws(() => transport.send("{}"), /Ante stdio transport is not connected/);
});
