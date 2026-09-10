import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleCrmAiRequest,
  parseCrmAiRequestBody,
  runKnowledgeOrganizeTask,
  runKnowledgeQaTask,
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

describe("crm-ai knowledge request parsing", () => {
  it("parses knowledge organize and qa tasks", () => {
    assert.deepEqual(
      parseCrmAiRequestBody({
        task: "knowledge_organize",
        schemaVersion: "knowledge-organize-v1",
        locale: "zh-Hant",
        systemPrompt: "system",
        userPrompt: "user",
      })?.task,
      "knowledge_organize",
    );
    assert.deepEqual(
      parseCrmAiRequestBody({
        task: "knowledge_qa",
        schemaVersion: "knowledge-qa-v1",
        locale: "en",
        systemPrompt: "system",
        userPrompt: "user",
      })?.task,
      "knowledge_qa",
    );
    assert.equal(
      parseCrmAiRequestBody({
        task: "knowledge_qa",
        schemaVersion: "wrong",
        locale: "en",
        systemPrompt: "system",
        userPrompt: "user",
      }),
      null,
    );
  });
});

describe("crm-ai knowledge tasks", () => {
  it("returns structured organize output from Workers AI", async () => {
    const env = makeEnv(async () => ({
      response: {
        title: "Title",
        summary: "Summary",
        body: "Body",
        suggestedCategory: null,
        warnings: ["資訊不足 / 需要人工補充"],
      },
    }));
    const result = await runKnowledgeOrganizeTask(env, {
      task: "knowledge_organize",
      schemaVersion: "knowledge-organize-v1",
      locale: "zh-Hant",
      systemPrompt: "system",
      userPrompt: "user",
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected success");
    assert.equal(result.model, KNOWLEDGE_MODEL);
    assert.equal(result.data.title, "Title");
  });

  it("returns structured QA output from Workers AI", async () => {
    const env = makeEnv(async () => ({
      response: {
        answer: "Published answer.",
        citationIds: ["article:1"],
        insufficientInformation: false,
      },
    }));
    const result = await runKnowledgeQaTask(env, {
      task: "knowledge_qa",
      schemaVersion: "knowledge-qa-v1",
      locale: "en",
      systemPrompt: "system",
      userPrompt: "user",
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected success");
    assert.equal(result.data.answer, "Published answer.");
  });

  it("maps invalid organize output to invalid_output", async () => {
    const env = makeEnv(async () => ({ response: { title: "<script>" } }));
    const result = await handleCrmAiRequest(env, {
      task: "knowledge_organize",
      schemaVersion: "knowledge-organize-v1",
      locale: "zh-Hant",
      systemPrompt: "system",
      userPrompt: "user",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.error, "invalid_output");
  });
});
