import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isUsableCandidateOrganizerDraft } from "@/lib/knowledge/knowledge-candidate-organizer-draft-usability";

describe("candidate organizer draft usability", () => {
  it("requires non-empty title summary and body", () => {
    assert.equal(
      isUsableCandidateOrganizerDraft({
        title: "t",
        summary: "s",
        body: "b",
        requestedProjectCode: null,
        requestedProjectName: "",
        categoryId: "",
        categoryNotice: "none",
        categoryResolutionSource: null,
        categoryResolutionStatus: null,
        categoryAiSuggestion: null,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        categoryAiRequiresConfirmation: false,
        categorySelectionRequired: false,
      }),
      true,
    );
    assert.equal(
      isUsableCandidateOrganizerDraft({
        title: "",
        summary: "s",
        body: "b",
        requestedProjectCode: null,
        requestedProjectName: "",
        categoryId: "",
        categoryNotice: "none",
        categoryResolutionSource: null,
        categoryResolutionStatus: null,
        categoryAiSuggestion: null,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        categoryAiRequiresConfirmation: false,
        categorySelectionRequired: false,
      }),
      false,
    );
  });

  it("UI ties organized label to usable draft hydration", () => {
    const card = readFileSync(
      join(
        process.cwd(),
        "src/components/knowledge/knowledge-segment-candidate-card.tsx",
      ),
      "utf8",
    );
    assert.match(card, /isUsableCandidateOrganizerDraft/);
    assert.match(card, /data-candidate-organized-title/);
    assert.match(card, /data-candidate-draft-hydrating/);
    assert.doesNotMatch(
      card,
      /candidate\.organizationCompleted \|\| Boolean\(draft/,
    );
  });
});
