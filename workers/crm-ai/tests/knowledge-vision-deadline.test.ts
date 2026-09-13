import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KNOWLEDGE_TOTAL_DEADLINE_MS,
  KNOWLEDGE_VISION_EXTRACT_MAX_TOKENS,
  KNOWLEDGE_VISION_TOTAL_DEADLINE_MS,
  resolveKnowledgeDeadlineMs,
  resolveKnowledgeVisionDeadlineMs,
} from "../src/models";
import { runKnowledgeVisionExtractTask } from "../src/service";
import { KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION } from "../src/models";

describe("knowledge vision deadline and token budget", () => {
  it("defaults vision deadline to 60,000 ms", () => {
    assert.equal(resolveKnowledgeVisionDeadlineMs(undefined), 60_000);
    assert.equal(KNOWLEDGE_VISION_TOTAL_DEADLINE_MS, 60_000);
  });

  it("caps vision deadline at 60,000 ms for production overrides", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.equal(resolveKnowledgeVisionDeadlineMs("90000"), 60_000);
      assert.equal(resolveKnowledgeVisionDeadlineMs("60000"), 60_000);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("keeps generic knowledge deadline unchanged at 20,000 ms", () => {
    assert.equal(resolveKnowledgeDeadlineMs(undefined), KNOWLEDGE_TOTAL_DEADLINE_MS);
    assert.equal(KNOWLEDGE_TOTAL_DEADLINE_MS, 20_000);
    assert.equal(resolveKnowledgeDeadlineMs(undefined), 20_000);
  });

  it("sets vision max_tokens budget to 4096", () => {
    assert.equal(KNOWLEDGE_VISION_EXTRACT_MAX_TOKENS, 4096);
  });

  it("honors short vision timeout overrides in test mode", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      assert.equal(resolveKnowledgeVisionDeadlineMs("50"), 50);
      assert.equal(resolveKnowledgeVisionDeadlineMs("200"), 200);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("isolates vision deadline from shared CRM_AI_TIMEOUT_MS default cap", () => {
    assert.equal(resolveKnowledgeVisionDeadlineMs(undefined), 60_000);
    assert.equal(resolveKnowledgeDeadlineMs("20000"), 20_000);
    assert.notEqual(
      resolveKnowledgeVisionDeadlineMs(undefined),
      resolveKnowledgeDeadlineMs("20000"),
    );
  });

  it("uses CRM_AI_VISION_TIMEOUT_MS for vision task short deadline in test mode", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const startedAt = Date.now();
      const result = await runKnowledgeVisionExtractTask(
        {
          AI: {} as Ai,
          CRM_AI_TIMEOUT_MS: "50",
          CRM_AI_VISION_TIMEOUT_MS: "50",
        },
        {
          task: "knowledge_vision_extract",
          schemaVersion: KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION,
          locale: "zh-Hant",
          mimeType: "image/png",
          imageBase64: "aGVsbG8=",
          byteSize: 5,
        },
      );
      const elapsedMs = Date.now() - startedAt;
      assert.equal(result.ok, false);
      assert.ok(elapsedMs < 5_000, `expected short vision timeout, got ${elapsedMs}ms`);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
