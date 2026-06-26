import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatHongKongDate,
  formatHongKongDateTime,
  formatHongKongTime,
} from "./timezone";

describe("Hong Kong timezone formatting", () => {
  it("formats UTC ISO strings as Hong Kong local time", () => {
    assert.equal(
      formatHongKongDateTime("2026-06-26T12:01:00Z"),
      "2026-06-26 20:01",
    );
  });

  it("treats naive ISO strings as UTC", () => {
    assert.equal(
      formatHongKongDateTime("2026-06-26T12:01:00"),
      "2026-06-26 20:01",
    );
  });

  it("formats date-only values", () => {
    assert.equal(formatHongKongDate("2026-06-26T12:01:00Z"), "2026-06-26");
  });

  it("formats time-only values", () => {
    assert.equal(formatHongKongTime("2026-06-26T12:01:00Z"), "20:01");
  });

  it("returns fallback for null, empty, and invalid values", () => {
    assert.equal(formatHongKongDateTime(null), "—");
    assert.equal(formatHongKongDateTime(""), "—");
    assert.equal(formatHongKongDateTime("not-a-date"), "—");
    assert.equal(formatHongKongDateTime(undefined, "N/A"), "N/A");
  });
});
