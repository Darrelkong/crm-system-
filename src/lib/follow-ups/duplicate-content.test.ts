import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DUPLICATE_FOLLOW_UP_WINDOW_MS,
  evaluateDuplicateFollowUpContent,
  normalizeFollowUpContentForDuplicateCheck,
} from "./duplicate-content";

describe("duplicate follow-up content", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const recent = new Date(
    now.getTime() - DUPLICATE_FOLLOW_UP_WINDOW_MS + 60_000,
  ).toISOString();

  it("normalizes trim and consecutive whitespace", () => {
    assert.equal(
      normalizeFollowUpContentForDuplicateCheck("  hello   world \n"),
      "hello world",
    );
  });

  it("flags identical normalized content within window", () => {
    const result = evaluateDuplicateFollowUpContent({
      newSummary: "  hello   world",
      previousSummary: "hello world",
      previousFollowUpTime: recent,
      now,
      confirmed: false,
    });
    assert.equal(result.kind, "duplicate_requires_confirm");
  });

  it("allows after confirm flag", () => {
    assert.equal(
      evaluateDuplicateFollowUpContent({
        newSummary: "hello world",
        previousSummary: "hello world",
        previousFollowUpTime: recent,
        now,
        confirmed: true,
      }).kind,
      "ok",
    );
  });

  it("ignores different content", () => {
    assert.equal(
      evaluateDuplicateFollowUpContent({
        newSummary: "different notes",
        previousSummary: "hello world",
        previousFollowUpTime: recent,
        now,
        confirmed: false,
      }).kind,
      "ok",
    );
  });

  it("ignores duplicates outside time window", () => {
    const old = new Date(
      now.getTime() - DUPLICATE_FOLLOW_UP_WINDOW_MS - 1000,
    ).toISOString();
    assert.equal(
      evaluateDuplicateFollowUpContent({
        newSummary: "hello world",
        previousSummary: "hello world",
        previousFollowUpTime: old,
        now,
        confirmed: false,
      }).kind,
      "ok",
    );
  });
});
