import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { requireKnowledgeIngestRole } from "@/lib/knowledge/source-service";

describe("smart ingest authorization", () => {
  it("K: viewer cannot start analysis-level ingest mutations", () => {
    assert.throws(
      () =>
        requireKnowledgeIngestRole({
          user: { id: "u1", role: "admin" },
          role: "viewer",
          access: { initialized: true, unlocked: true },
        } as never),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED);
        return true;
      },
    );
  });
});
