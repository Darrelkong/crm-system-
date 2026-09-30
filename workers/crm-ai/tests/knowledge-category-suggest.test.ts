import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateKnowledgeCategorySuggestRequest } from "../src/knowledge";

describe("knowledge category suggest task", () => {
  it("accepts valid request", () => {
    const request = validateKnowledgeCategorySuggestRequest({
      task: "knowledge_category_suggest",
      schemaVersion: "knowledge-category-suggest-v1",
      locale: "zh-Hans",
      systemPrompt: "system",
      userPrompt: "user",
    });
    assert.ok(request);
    assert.equal(request?.task, "knowledge_category_suggest");
  });

  it("rejects unknown schema version", () => {
    const request = validateKnowledgeCategorySuggestRequest({
      task: "knowledge_category_suggest",
      schemaVersion: "wrong",
      locale: "zh-Hans",
      systemPrompt: "system",
      userPrompt: "user",
    });
    assert.equal(request, null);
  });
});
