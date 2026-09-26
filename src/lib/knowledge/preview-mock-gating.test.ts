import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { allowMockDeepInsightGeneration } from "@/lib/ai/providers/mock-constants";
import { extractKnowledgeVisionImage } from "@/lib/knowledge/vision-extraction-provider";
import { loadKnowledgePreviewIngestFixtureBytes } from "@/lib/knowledge/test-fixtures/source-images";

const organizerPath = new URL("../knowledge/ai-organizer-service.ts", import.meta.url);
const comparisonPath = new URL("../knowledge/comparison-service.ts", import.meta.url);
const visionPath = new URL("../knowledge/vision-extraction-provider.ts", import.meta.url);

describe("preview mock gating", () => {
  const prevBind = process.env.CRM_ALLOW_TEST_DB_BIND;
  const prevMock = process.env.CRM_ALLOW_MOCK_AI;

  afterEach(() => {
    if (prevBind === undefined) delete process.env.CRM_ALLOW_TEST_DB_BIND;
    else process.env.CRM_ALLOW_TEST_DB_BIND = prevBind;
    if (prevMock === undefined) delete process.env.CRM_ALLOW_MOCK_AI;
    else process.env.CRM_ALLOW_MOCK_AI = prevMock;
  });

  it("denies mock when both flags are absent", () => {
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    delete process.env.CRM_ALLOW_MOCK_AI;
    assert.equal(allowMockDeepInsightGeneration(), false);
  });

  it("enables mock when CRM_ALLOW_MOCK_AI=1", () => {
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    process.env.CRM_ALLOW_MOCK_AI = "1";
    assert.equal(allowMockDeepInsightGeneration(), true);
  });

  it("routes vision extraction to mock when CRM_ALLOW_MOCK_AI=1", async () => {
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    process.env.CRM_ALLOW_MOCK_AI = "1";
    const result = await extractKnowledgeVisionImage({
      bytes: loadKnowledgePreviewIngestFixtureBytes("p2c-b1-table.png"),
      filename: "p2c-b1-table.png",
      mimeType: "image/png",
    });
    assert.equal(result.model, "mock-knowledge-vision-v1");
    assert.match(result.text, /汇丰香港/);
  });

  it("keeps organizer and comparison on allowMockDeepInsightGeneration gate", () => {
    const organizerSource = readFileSync(organizerPath, "utf8");
    const comparisonSource = readFileSync(comparisonPath, "utf8");
    const visionSource = readFileSync(visionPath, "utf8");
    const executionSource = readFileSync(new URL("./knowledge-organization-execution.ts", import.meta.url), "utf8");
    assert.match(organizerSource, /await executeKnowledgeOrganizationOnEvidence\(/);
    assert.match(executionSource, /if \(allowMockDeepInsightGeneration\(\)\)/);
    assert.match(comparisonSource, /allowMockDeepInsightGeneration\(\)/);
    assert.match(visionSource, /allowMockDeepInsightGeneration\(\)/);
    assert.match(executionSource, /mock-knowledge-organizer-v1/);
    assert.match(comparisonSource, /mock-knowledge-compare-v1/);
  });

  it("does not enable mock from wrangler-only vars without process.env", () => {
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    delete process.env.CRM_ALLOW_MOCK_AI;
    assert.equal(allowMockDeepInsightGeneration(), false);
    const gate = allowMockDeepInsightGeneration.toString();
    assert.match(gate, /process\.env\.CRM_ALLOW_MOCK_AI/);
    assert.doesNotMatch(gate, /getCloudflareContext/);
  });
});
