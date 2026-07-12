import assert from "node:assert/strict";
import test from "node:test";
import {
  extractErrorMessage,
  extractExtensionRefreshed,
  extractModelSpec,
  extractProviderSpec,
  extractTurnStatus,
} from "../src/protocol/events.js";

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

test("extracts skills, subagents, and MCP servers from ExtensionRefreshed", () => {
  const payload = {
    session_id: "ses_test",
    skills: [
      { name: "commit", description: "Create a git commit", scope: "user", argument_hint: "-m 'message'" },
      { name: "", description: "dropped: no name" },
    ],
    subagents: [{ name: "explore", description: "Explore the codebase", scope: "project" }],
    mcp_servers: [
      {
        name: "filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        tools: [
          {
            name: "read_text_file",
            qualified_name: "mcp__filesystem__read_text_file",
            description: "Read the contents of a text file",
            parameters: [{ name: "path", param_type: "string", required: true, description: "Path to the file" }],
          },
        ],
      },
    ],
  };

  const extracted = extractExtensionRefreshed(payload);

  assert.deepEqual(extracted.skills, [
    { name: "commit", description: "Create a git commit", scope: "user", argumentHint: "-m 'message'" },
  ]);
  assert.deepEqual(extracted.subagents, [
    { name: "explore", description: "Explore the codebase", scope: "project" },
  ]);
  assert.deepEqual(extracted.mcpServers, [
    {
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      tools: [
        {
          name: "read_text_file",
          qualifiedName: "mcp__filesystem__read_text_file",
          description: "Read the contents of a text file",
          parameters: [{ name: "path", paramType: "string", required: true, description: "Path to the file" }],
        },
      ],
    },
  ]);
});

test("returns empty extension lists for malformed payloads", () => {
  assert.deepEqual(extractExtensionRefreshed(null), { skills: [], subagents: [], mcpServers: [] });
  assert.deepEqual(extractExtensionRefreshed({}), { skills: [], subagents: [], mcpServers: [] });
});

test("extractModelSpec reads the daemon's `id` field, not just `name`", () => {
  const spec = extractModelSpec({
    id: "claude-sonnet-4-6",
    description: "Fast and capable",
    effort: "high",
  });

  assert.equal(spec?.name, "claude-sonnet-4-6");
});

test("extractProviderSpec reads the daemon's `id`/`display_name` fields", () => {
  const spec = extractProviderSpec({
    id: "anthropic",
    display_name: "Anthropic",
    base_url: "https://api.anthropic.com/",
  });

  assert.equal(spec?.name, "anthropic");
  assert.equal(spec?.displayName, "Anthropic");
});
