import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  comparisonMatchesOrganizerDraft,
  isCandidateComparisonStale,
  normalizeComparedOrganizerDraft,
} from "@/lib/knowledge/knowledge-candidate-comparison-draft";

describe("knowledge candidate comparison draft fingerprint", () => {
  it("detects stale comparison after organizer edit", () => {
    const draft = normalizeComparedOrganizerDraft({
      title: "A",
      summary: "B",
      body: "C",
    });
    const comparison = {
      relationship: "new_article" as const,
      matchedCandidateKey: null,
      matchConfidence: 0.2,
      newFacts: [],
      changedFacts: [],
      conflicts: [],
      uncertainties: [],
      suggestedUpdates: [],
      comparedOrganizerDraft: draft,
    };
    assert.equal(comparisonMatchesOrganizerDraft(comparison, draft), true);
    assert.equal(
      isCandidateComparisonStale(comparison, {
        title: "A2",
        summary: "B",
        body: "C",
      }),
      true,
    );
  });
});
