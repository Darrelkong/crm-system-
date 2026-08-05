import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReclaimTimelineMessage,
  buildWarningTimelineMessage,
  getReclamationWarningMilestone,
  getWarningSequenceNumber,
  isFinalReclamationWarning,
} from "./milestones";

describe("reclamation milestones", () => {
  const reclaimDays = 45;

  it("warns every 7 idle days before final window", () => {
    assert.equal(getReclamationWarningMilestone(6, reclaimDays), null);
    assert.equal(getReclamationWarningMilestone(7, reclaimDays), 7);
    assert.equal(getReclamationWarningMilestone(14, reclaimDays), 14);
    assert.equal(getReclamationWarningMilestone(21, reclaimDays), 21);
    assert.equal(getReclamationWarningMilestone(42, reclaimDays), 42);
    assert.equal(getReclamationWarningMilestone(8, reclaimDays), null);
  });

  it("warns at reclaimDays - 1 as final urgent warning", () => {
    assert.equal(getReclamationWarningMilestone(44, reclaimDays), 44);
    assert.equal(isFinalReclamationWarning(44, reclaimDays), true);
    assert.equal(isFinalReclamationWarning(42, reclaimDays), false);
  });

  it("does not warn at or beyond reclaim threshold", () => {
    assert.equal(getReclamationWarningMilestone(45, reclaimDays), null);
    assert.equal(getReclamationWarningMilestone(50, reclaimDays), null);
  });

  it("sequence numbers for periodic warnings", () => {
    assert.equal(getWarningSequenceNumber(7, reclaimDays), 1);
    assert.equal(getWarningSequenceNumber(14, reclaimDays), 2);
    assert.equal(getWarningSequenceNumber(44, reclaimDays), 0);
  });

  it("timeline messages include rule snapshot", () => {
    const periodic = buildWarningTimelineMessage({
      milestone: 28,
      idleDays: 28,
      reclaimDays: 45,
      isFinal: false,
    });
    assert.match(periodic, /第 4 次/);
    assert.match(periodic, /当时自动释放规则：45 天/);

    const finalMsg = buildWarningTimelineMessage({
      milestone: 44,
      idleDays: 44,
      reclaimDays: 45,
      isFinal: true,
    });
    assert.match(finalMsg, /系统紧急回收预警/);
    assert.match(finalMsg, /1 天后/);

    const reclaim = buildReclaimTimelineMessage(45);
    assert.match(reclaim, /系统自动释放记录/);
    assert.match(reclaim, /当时自动释放规则：45 天/);
  });
});
