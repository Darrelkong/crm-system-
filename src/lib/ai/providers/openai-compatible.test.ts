import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChatCompletionsUrl } from "./openai-compatible";

describe("buildChatCompletionsUrl", () => {
  it("appends /v1/chat/completions for OpenAI official base URL", () => {
    assert.equal(
      buildChatCompletionsUrl("https://api.openai.com"),
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("strips trailing slash for OpenAI official base URL", () => {
    assert.equal(
      buildChatCompletionsUrl("https://api.openai.com/"),
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("appends /chat/completions for Gemini OpenAI-compatible base URL", () => {
    assert.equal(
      buildChatCompletionsUrl("https://generativelanguage.googleapis.com/v1beta/openai"),
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
  });

  it("strips trailing slash for Gemini OpenAI-compatible base URL", () => {
    assert.equal(
      buildChatCompletionsUrl("https://generativelanguage.googleapis.com/v1beta/openai/"),
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
  });
});
