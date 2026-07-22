import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QUICK_ENTRY_SUBMISSION_ERROR_CODES } from "@/lib/public-pool/quick-entry-submission-constants";
import {
  validateQuickEntryClientRowId,
  validateQuickEntrySubmissionId,
} from "@/lib/public-pool/quick-entry-submission-validation";

const VALID_V4 = "550e8400-e29b-41d4-a716-446655440000";

describe("validateQuickEntrySubmissionId", () => {
  it("accepts UUID v4", () => {
    const result = validateQuickEntrySubmissionId(VALID_V4);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value, VALID_V4);
  });

  it("rejects non-string / object / array", () => {
    assert.equal(validateQuickEntrySubmissionId(null).ok, false);
    assert.equal(validateQuickEntrySubmissionId(1).ok, false);
    assert.equal(validateQuickEntrySubmissionId({}).ok, false);
    assert.equal(validateQuickEntrySubmissionId([VALID_V4]).ok, false);
  });

  it("rejects trimmed mismatch and invalid UUID", () => {
    const padded = validateQuickEntrySubmissionId(` ${VALID_V4} `);
    assert.equal(padded.ok, false);
    if (!padded.ok) {
      assert.equal(
        padded.errorCode,
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ID_INVALID,
      );
    }
    assert.equal(validateQuickEntrySubmissionId("not-a-uuid").ok, false);
  });

  it("rejects UUID v1 (version nibble not 4)", () => {
    const v1 = "550e8400-e29b-11d4-a716-446655440000";
    const result = validateQuickEntrySubmissionId(v1);
    assert.equal(result.ok, false);
  });
});

describe("validateQuickEntryClientRowId", () => {
  it("accepts valid ids", () => {
    assert.equal(validateQuickEntryClientRowId("r1").ok, true);
    assert.equal(validateQuickEntryClientRowId("row_ABC-01").ok, true);
    assert.equal(validateQuickEntryClientRowId("a".repeat(64)).ok, true);
  });

  it("rejects empty, too long, slash, dot, space, unicode", () => {
    assert.equal(validateQuickEntryClientRowId("").ok, false);
    assert.equal(validateQuickEntryClientRowId("a".repeat(65)).ok, false);
    assert.equal(validateQuickEntryClientRowId("a/b").ok, false);
    assert.equal(validateQuickEntryClientRowId("a.b").ok, false);
    assert.equal(validateQuickEntryClientRowId("a b").ok, false);
    assert.equal(validateQuickEntryClientRowId("行1").ok, false);
  });

  it("rejects non-string", () => {
    assert.equal(validateQuickEntryClientRowId(null).ok, false);
    assert.equal(validateQuickEntryClientRowId(["r1"]).ok, false);
    assert.equal(validateQuickEntryClientRowId({ id: "r1" }).ok, false);
    const bad = validateQuickEntryClientRowId(12);
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(
        bad.errorCode,
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.CLIENT_ROW_ID_INVALID,
      );
    }
  });
});
