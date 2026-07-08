import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatConfidencePercent,
  resolveAiConfidenceLevel,
} from "@/lib/ai/customer-insights/confidence-display";

describe("resolveAiConfidenceLevel", () => {
  it("maps 0.7 to high", () => {
    assert.equal(resolveAiConfidenceLevel(0.7), "high");
  });

  it("maps 0.4 to medium", () => {
    assert.equal(resolveAiConfidenceLevel(0.4), "medium");
  });

  it("maps 0.39 to low", () => {
    assert.equal(resolveAiConfidenceLevel(0.39), "low");
  });

  it("maps 1 to high", () => {
    assert.equal(resolveAiConfidenceLevel(1), "high");
  });

  it("maps 0 to low", () => {
    assert.equal(resolveAiConfidenceLevel(0), "low");
  });
});

describe("formatConfidencePercent", () => {
  it("rounds confidence to percent", () => {
    assert.equal(formatConfidencePercent(0.785), 79);
  });
});
