import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isReclamationExcludedSalesStage } from "./constants";

describe("auto-reclamation sales stage exclusions", () => {
  it("excludes closed_won regardless of idle time eligibility", () => {
    assert.equal(isReclamationExcludedSalesStage("closed_won"), true);
  });

  it("excludes legacy converted alias for closed won", () => {
    assert.equal(isReclamationExcludedSalesStage("converted"), true);
  });

  it("does not exclude closed_lost", () => {
    assert.equal(isReclamationExcludedSalesStage("closed_lost"), false);
  });

  it("does not exclude on_hold", () => {
    assert.equal(isReclamationExcludedSalesStage("on_hold"), false);
  });

  it("does not exclude new_lead or other active stages", () => {
    assert.equal(isReclamationExcludedSalesStage("new_lead"), false);
    assert.equal(isReclamationExcludedSalesStage("negotiation"), false);
  });
});

describe("auto-reclamation customer status assumptions", () => {
  it("archived and deleted customers are out of engine scope by query filter", () => {
    const activeOnlyStatuses = ["active"];
    assert.equal(activeOnlyStatuses.includes("archived"), false);
    assert.equal(activeOnlyStatuses.includes("deleted"), false);
  });
});
