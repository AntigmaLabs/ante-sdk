import assert from "node:assert/strict";
import test from "node:test";
import { extractErrorMessage, extractTurnStatus } from "../src/protocol/events.js";

test("extracts TurnEnd status.Error details", () => {
  const payload = {
    turn_id: "op_test",
    status: {
      Error: {
        headline: "llm error",
        details: [
          "failed to refresh oauth token: HTTP status client error (401 Unauthorized)",
        ],
      },
    },
  };

  assert.equal(extractTurnStatus(payload), "Error");
  assert.equal(
    extractErrorMessage(payload),
    "llm error: failed to refresh oauth token: HTTP status client error (401 Unauthorized)",
  );
});

test("combines TurnEnd status.Error headline with string details", () => {
  const payload = {
    turn_id: "op_test",
    status: {
      Error: {
        headline: "llm error",
        details: "provider token expired",
      },
    },
  };

  assert.equal(extractErrorMessage(payload), "llm error: provider token expired");
});
