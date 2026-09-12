import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleCrmAiRequest,
  parseCrmAiRequestBody,
  runKnowledgeCompareTask,
} from "../src/service";
import { KNOWLEDGE_MODEL } from "../src/models";
import type { CrmAiEnv } from "../src/types";

function makeEnv(
  runImpl: (model: string, payload: unknown, options: unknown) => Promise<unknown>,
): CrmAiEnv {
  return {
    AI: {
      run: runImpl,
    } as unknown as Ai,
  };
}

const validCompareOutput = {
  relationship: "update_existing",
  matchedCandidateKey: "C1",
  matchConfidence: 0.9,
  newFacts: [
    {
      id: "nf-1",
      topic: "资产要求",
      existingValue: null,
      incomingValue: "新增",
      explanation: "新增信息",
      confidence: 0.8,
      sourceExcerpt: "新增",
      existingExcerpt: null,
    },
  ],
  changedFacts: [],
  conflicts: [],
  uncertainties: [],
  suggestedUpdates: [],
};

describe("crm-ai knowledge_compare request parsing", () => {
  it("parses knowledge_compare with schema version validation", () => {
    assert.deepEqual(
      parseCrmAiRequestBody({
        task: "knowledge_compare",
        schemaVersion: "knowledge-compare-v1",
        locale: "zh-Hant",
        systemPrompt: "system",
        userPrompt: "user",
      })?.task,
      "knowledge_compare",
    );
    assert.equal(
      parseCrmAiRequestBody({
        task: "knowledge_compare",
        schemaVersion: "wrong",
        locale: "zh-Hant",
        systemPrompt: "system",
        userPrompt: "user",
      }),
      null,
    );
  });

  it("rejects oversized prompts", () => {
    assert.equal(
      parseCrmAiRequestBody({
        task: "knowledge_compare",
        schemaVersion: "knowledge-compare-v1",
        locale: "zh-Hant",
        systemPrompt: "system",
        userPrompt: "x".repeat(70_001),
      }),
      null,
    );
  });
});

describe("crm-ai knowledge_compare tasks", () => {
  it("returns structured compare output from Workers AI", async () => {
    const env = makeEnv(async () => ({ response: validCompareOutput }));
    const result = await runKnowledgeCompareTask(env, {
      task: "knowledge_compare",
      schemaVersion: "knowledge-compare-v1",
      locale: "zh-Hant",
      systemPrompt: "system",
      userPrompt: "user",
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected success");
    assert.equal(result.model, KNOWLEDGE_MODEL);
    assert.equal(result.data.matchedCandidateKey, "C1");
  });

  it("maps invalid compare output to invalid_output", async () => {
    const env = makeEnv(async () => ({
      response: {
        relationship: "update_existing",
        matchedCandidateKey: "C99",
        matchConfidence: 0.5,
        newFacts: [],
        changedFacts: [],
        conflicts: [],
        uncertainties: [],
        suggestedUpdates: [],
      },
    }));
    const result = await handleCrmAiRequest(env, {
      task: "knowledge_compare",
      schemaVersion: "knowledge-compare-v1",
      locale: "zh-Hant",
      systemPrompt: "system",
      userPrompt: "user",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.error, "invalid_output");
  });

  it("maps malformed JSON to invalid_output", async () => {
    const env = makeEnv(async () => ({ response: { relationship: "broken" } }));
    const result = await handleCrmAiRequest(env, {
      task: "knowledge_compare",
      schemaVersion: "knowledge-compare-v1",
      locale: "zh-Hant",
      systemPrompt: "system",
      userPrompt: "user",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.error, "invalid_output");
  });
});
