import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  processKnowledgeSourceAnalysisRun,
  startKnowledgeSourceAnalysis,
} from "@/lib/knowledge/smart-ingest-analysis-service";

describe("smart ingest analysis service guards", () => {
  it("J: rejects file source type without database", async () => {
    await assert.rejects(
      () =>
        startKnowledgeSourceAnalysis(
          {
            user: { id: "u1", role: "admin" },
            role: "contributor",
            access: { initialized: true, unlocked: true },
          } as never,
          "missing",
          {},
          {
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => Promise.resolve([]),
                }),
              }),
            }),
          } as never,
        ),
      (error: unknown) => error instanceof KnowledgeServiceError,
    );
  });
});

describe("smart ingest analysis error codes", () => {
  it("documents expected analysis error codes", () => {
    assert.equal(KNOWLEDGE_ERROR_CODES.ANALYSIS_EMPTY_SOURCE, "ANALYSIS_EMPTY_SOURCE");
    assert.equal(
      KNOWLEDGE_ERROR_CODES.ANALYSIS_UNSUPPORTED_SOURCE_TYPE,
      "UNSUPPORTED_SOURCE_TYPE",
    );
    assert.equal(
      KNOWLEDGE_ERROR_CODES.ANALYSIS_ALREADY_RUNNING,
      "ANALYSIS_ALREADY_RUNNING",
    );
  });
});
