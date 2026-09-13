import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runKnowledgeVisionExtract,
  validateKnowledgeVisionExtractOutput,
  validateKnowledgeVisionExtractRequest,
} from "../src/knowledge-vision";
import { KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION } from "../src/models";

describe("knowledge vision extract task", () => {
  it("validates request shape", () => {
    const request = validateKnowledgeVisionExtractRequest({
      task: "knowledge_vision_extract",
      schemaVersion: KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION,
      locale: "zh-Hant",
      mimeType: "image/png",
      imageBase64: "aGVsbG8=",
      byteSize: 5,
    });
    assert.ok(request);
    assert.equal(request?.mimeType, "image/png");
  });

  it("rejects invalid mime type", () => {
    assert.equal(
      validateKnowledgeVisionExtractRequest({
        task: "knowledge_vision_extract",
        schemaVersion: KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION,
        locale: "zh-Hant",
        mimeType: "image/webp",
        imageBase64: "aGVsbG8=",
        byteSize: 5,
      }),
      null,
    );
  });

  it("validates structured output", () => {
    const output = validateKnowledgeVisionExtractOutput({
      text: "汇丰香港\n最低资产要求 50 万",
      quality: "high",
      warnings: [],
    });
    assert.ok(output);
    assert.match(output?.text ?? "", /50 万/);
  });

  it("rejects guessed digits in validation bounds only via provider contract", async () => {
    const result = await runKnowledgeVisionExtract(
      { AI: {} as Ai },
      {
        task: "knowledge_vision_extract",
        schemaVersion: KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION,
        locale: "zh-Hant",
        mimeType: "image/png",
        imageBase64: "aGVsbG8=",
        byteSize: 5,
      },
      async () => ({
        response: {
          text: "最低资产要求 5? 万",
          quality: "medium",
          warnings: [{ code: "UNREADABLE_NUMBER", message: null }],
        },
      }),
      5_000,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.data.text, /5\?\s*万/);
    }
  });

  it("wraps Gemma-style plain transcription into structured output", async () => {
    const result = await runKnowledgeVisionExtract(
      { AI: {} as Ai },
      {
        task: "knowledge_vision_extract",
        schemaVersion: KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION,
        locale: "zh-Hant",
        mimeType: "image/png",
        imageBase64: "aGVsbG8=",
        byteSize: 5,
      },
      async () => ({
        choices: [
          {
            message: {
              content: "汇丰香港\n最低资产要求 50 万",
            },
          },
        ],
      }),
      5_000,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.data.text, /汇丰香港/);
      assert.equal(result.data.quality, "high");
    }
  });

  it("returns invalid_output for empty provider transcription", async () => {
    const result = await runKnowledgeVisionExtract(
      { AI: {} as Ai },
      {
        task: "knowledge_vision_extract",
        schemaVersion: KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION,
        locale: "zh-Hant",
        mimeType: "image/png",
        imageBase64: "aGVsbG8=",
        byteSize: 5,
      },
      async () => ({ choices: [{ message: { content: "" } }] }),
      5_000,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "invalid_output");
    }
  });
});
