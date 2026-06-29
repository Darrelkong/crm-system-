import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_NEXT_ACTION_LENGTH,
  MIN_NEXT_FOLLOW_UP_LEAD_MINUTES,
  normalizeNextFollowUpAt,
  validateFollowUpInput,
} from "./validation";

const fixedNow = new Date("2026-06-24T10:00:00.000Z");

function atOffsetMinutes(minutes: number): string {
  return new Date(fixedNow.getTime() + minutes * 60 * 1000).toISOString();
}

const validBase = {
  channel: "phone",
  outcome: "contact_made",
  summary: "这是一段足够长的跟进摘要内容",
  customerIntent: "客户希望了解产品报价方案",
  nextFollowUpAt: atOffsetMinutes(MIN_NEXT_FOLLOW_UP_LEAD_MINUTES),
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
  it("rejects blank nextFollowUpAt", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextFollowUpAt: null },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "nextFollowUpAt"), [
      "NEXT_FOLLOW_UP_REQUIRED",
    ]);
  });

  it("rejects empty string nextFollowUpAt", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextFollowUpAt: "" },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "nextFollowUpAt"), [
      "NEXT_FOLLOW_UP_REQUIRED",
    ]);
  });

  it("rejects invalid datetime string", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextFollowUpAt: "not-a-date" },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "nextFollowUpAt"), [
      "NEXT_FOLLOW_UP_INVALID",
    ]);
  });

  it("rejects past time", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextFollowUpAt: atOffsetMinutes(-10) },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "nextFollowUpAt"), [
      "NEXT_FOLLOW_UP_TOO_SOON",
    ]);
  });

  it("rejects current time", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextFollowUpAt: fixedNow.toISOString() },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "nextFollowUpAt"), [
      "NEXT_FOLLOW_UP_TOO_SOON",
    ]);
  });

  it("rejects now + 30 minutes", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextFollowUpAt: atOffsetMinutes(30) },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "nextFollowUpAt"), [
      "NEXT_FOLLOW_UP_TOO_SOON",
    ]);
  });

  it("accepts now + 45 minutes", () => {
    const errors = validateFollowUpInput(
      {
        ...validBase,
        nextFollowUpAt: atOffsetMinutes(MIN_NEXT_FOLLOW_UP_LEAD_MINUTES),
      },
      { now: fixedNow },
    );
    assert.equal(fieldCodes(errors, "nextFollowUpAt").length, 0);
  });

  it("accepts now + 60 minutes", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextFollowUpAt: atOffsetMinutes(60) },
      { now: fixedNow },
    );
    assert.equal(fieldCodes(errors, "nextFollowUpAt").length, 0);
  });
});

describe("validateFollowUpInput customerIntent", () => {
  it("rejects empty customerIntent", () => {
    const errors = validateFollowUpInput(
      { ...validBase, customerIntent: "   " },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "customerIntent"), [
      "CUSTOMER_INTENT_REQUIRED",
    ]);
  });

  it("accepts non-empty customerIntent", () => {
    const errors = validateFollowUpInput(validBase, { now: fixedNow });
    assert.equal(fieldCodes(errors, "customerIntent").length, 0);
  });
});

describe("validateFollowUpInput nextAction", () => {
  it("rejects nextAction shorter than 10 characters after trim", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextAction: "只有九个字哦" },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "nextAction"), ["NEXT_ACTION_TOO_SHORT"]);
  });

  it("accepts nextAction with exactly 10 characters", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextAction: "1234567890" },
      { now: fixedNow },
    );
    assert.equal(fieldCodes(errors, "nextAction").length, 0);
  });

  it("accepts nextAction with more than 10 characters", () => {
    const errors = validateFollowUpInput(validBase, { now: fixedNow });
    assert.equal(fieldCodes(errors, "nextAction").length, 0);
  });

  it("does not count leading or trailing whitespace toward length", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextAction: "   123456789   " },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "nextAction"), ["NEXT_ACTION_TOO_SHORT"]);
    assert.equal("123456789".trim().length, 9);
    assert.equal(MIN_NEXT_ACTION_LENGTH, 10);
  });

  it("rejects empty nextAction", () => {
    const errors = validateFollowUpInput(
      { ...validBase, nextAction: "   " },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "nextAction"), ["NEXT_ACTION_REQUIRED"]);
  });
});

describe("validateFollowUpInput required fields", () => {
  it("still validates channel, outcome, and summary", () => {
    const errors = validateFollowUpInput(
      {
        channel: "",
        outcome: "",
        summary: "",
        customerIntent: validBase.customerIntent,
        nextFollowUpAt: validBase.nextFollowUpAt,
        nextAction: validBase.nextAction,
      },
      { now: fixedNow },
    );
    assert.ok(codes(errors).includes("FOLLOW_UP_CHANNEL_REQUIRED"));
    assert.ok(codes(errors).includes("FOLLOW_UP_OUTCOME_REQUIRED"));
    assert.ok(codes(errors).includes("FOLLOW_UP_SUMMARY_REQUIRED"));
  });

  it("still rejects summary shorter than 5 characters", () => {
    const errors = validateFollowUpInput(
      { ...validBase, summary: "太短" },
      { now: fixedNow },
    );
    assert.deepEqual(fieldCodes(errors, "summary"), [
      "FOLLOW_UP_SUMMARY_TOO_SHORT",
    ]);
  });
});
