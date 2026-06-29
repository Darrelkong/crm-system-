import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_NEXT_ACTION_LENGTH,
  normalizeNextFollowUpAt,
  validateFollowUpInput,
} from "./validation";

const validBase = {
  channel: "phone",
  outcome: "contact_made",
  summary: "这是一段足够长的跟进摘要内容",
  nextAction: "安排下周再次电话沟通确认需求细节",
};

function codes(errors: ReturnType<typeof validateFollowUpInput>): string[] {
  return errors.map((e) => e.code);
}

function fieldCodes(
  errors: ReturnType<typeof validateFollowUpInput>,
  field: string,
): string[] {
  return errors.filter((e) => e.field === field).map((e) => e.code);
}

describe("normalizeNextFollowUpAt", () => {
  it("returns null for empty, null, or whitespace", () => {
    assert.equal(normalizeNextFollowUpAt(""), null);
    assert.equal(normalizeNextFollowUpAt("   "), null);
    assert.equal(normalizeNextFollowUpAt(null), null);
    assert.equal(normalizeNextFollowUpAt(undefined), null);
  });

  it("returns trimmed value for non-empty input", () => {
    assert.equal(
      normalizeNextFollowUpAt("  2025-06-24T10:00:00.000Z  "),
      "2025-06-24T10:00:00.000Z",
    );
  });
});

describe("validateFollowUpInput nextFollowUpAt", () => {
  it("allows blank nextFollowUpAt", () => {
    const errors = validateFollowUpInput({
      ...validBase,
      nextFollowUpAt: null,
    });
    assert.equal(fieldCodes(errors, "nextFollowUpAt").length, 0);
  });

  it("allows empty string nextFollowUpAt", () => {
    const errors = validateFollowUpInput({
      ...validBase,
      nextFollowUpAt: "",
    });
    assert.equal(fieldCodes(errors, "nextFollowUpAt").length, 0);
  });

  it("accepts valid ISO datetime", () => {
    const errors = validateFollowUpInput({
      ...validBase,
      nextFollowUpAt: "2025-12-01T14:30:00.000Z",
    });
    assert.equal(fieldCodes(errors, "nextFollowUpAt").length, 0);
  });

  it("rejects invalid datetime string", () => {
    const errors = validateFollowUpInput({
      ...validBase,
      nextFollowUpAt: "not-a-date",
    });
    assert.deepEqual(fieldCodes(errors, "nextFollowUpAt"), [
      "NEXT_FOLLOW_UP_INVALID",
    ]);
  });
});

describe("validateFollowUpInput nextAction", () => {
  it("rejects nextAction shorter than 10 characters after trim", () => {
    const errors = validateFollowUpInput({
      ...validBase,
      nextAction: "只有九个字哦",
    });
    assert.deepEqual(fieldCodes(errors, "nextAction"), ["NEXT_ACTION_TOO_SHORT"]);
  });

  it("accepts nextAction with exactly 10 characters", () => {
    const errors = validateFollowUpInput({
      ...validBase,
      nextAction: "1234567890",
    });
    assert.equal(fieldCodes(errors, "nextAction").length, 0);
  });

  it("accepts nextAction with more than 10 characters", () => {
    const errors = validateFollowUpInput({
      ...validBase,
      nextAction: "安排下周再次电话沟通确认需求细节",
    });
    assert.equal(fieldCodes(errors, "nextAction").length, 0);
  });

  it("does not count leading or trailing whitespace toward length", () => {
    const errors = validateFollowUpInput({
      ...validBase,
      nextAction: "   123456789   ",
    });
    assert.deepEqual(fieldCodes(errors, "nextAction"), ["NEXT_ACTION_TOO_SHORT"]);
    assert.equal("123456789".trim().length, 9);
    assert.equal(MIN_NEXT_ACTION_LENGTH, 10);
  });

  it("rejects empty nextAction", () => {
    const errors = validateFollowUpInput({
      ...validBase,
      nextAction: "   ",
    });
    assert.deepEqual(fieldCodes(errors, "nextAction"), ["NEXT_ACTION_REQUIRED"]);
  });
});

describe("validateFollowUpInput required fields", () => {
  it("still validates channel, outcome, and summary", () => {
    const errors = validateFollowUpInput({
      channel: "",
      outcome: "",
      summary: "",
      nextFollowUpAt: null,
      nextAction: validBase.nextAction,
    });
    assert.ok(codes(errors).includes("FOLLOW_UP_CHANNEL_REQUIRED"));
    assert.ok(codes(errors).includes("FOLLOW_UP_OUTCOME_REQUIRED"));
    assert.ok(codes(errors).includes("FOLLOW_UP_SUMMARY_REQUIRED"));
  });

  it("still rejects summary shorter than 5 characters", () => {
    const errors = validateFollowUpInput({
      ...validBase,
      summary: "太短",
      nextFollowUpAt: null,
    });
    assert.deepEqual(fieldCodes(errors, "summary"), [
      "FOLLOW_UP_SUMMARY_TOO_SHORT",
    ]);
  });
});
