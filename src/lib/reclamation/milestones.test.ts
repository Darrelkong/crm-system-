import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReclaimTimelineMessage,
  buildWarningTimelineMessage,
  getPeriodicWarningMilestones,
  getWarningSequenceNumber,
  isFinalReclamationWarning,
  isInFinalWarningWindow,
  resolveNextWarningMilestone,
} from "./milestones";

describe("reclamation milestones", () => {
  const reclaimDays = 45;

  it("lists periodic nodes below the final milestone", () => {
    assert.deepEqual(getPeriodicWarningMilestones(45), [7, 14, 21, 28, 35, 42]);
    assert.deepEqual(getPeriodicWarningMilestones(14), [7]);
    assert.deepEqual(getPeriodicWarningMilestones(8), []);
  });

  it("day 8 with no sent milestones sends day 7", () => {
    assert.equal(resolveNextWarningMilestone(8, reclaimDays, new Set()), 7);
  });

  it("day 15 with no sent milestones sends day 14 directly", () => {
    assert.equal(resolveNextWarningMilestone(15, reclaimDays, new Set()), 14);
  });

  it("day 15 after day 7 sent sends day 14", () => {
    assert.equal(
      resolveNextWarningMilestone(15, reclaimDays, new Set([7])),
      14,
    );
  });

  it("day 22 with no sent milestones sends day 21 directly", () => {
    assert.equal(resolveNextWarningMilestone(22, reclaimDays, new Set()), 21);
  });

  it("day 22 after only day 7 sent sends day 21 directly", () => {
    assert.equal(
      resolveNextWarningMilestone(22, reclaimDays, new Set([7])),
      21,
    );
  });

  it("day 22 after day 14 sent sends day 21", () => {
    assert.equal(
      resolveNextWarningMilestone(22, reclaimDays, new Set([14])),
      21,
    );
  });

  it("day 22 after day 21 sent sends nothing", () => {
    assert.equal(
      resolveNextWarningMilestone(22, reclaimDays, new Set([21])),
      null,
    );
  });

  it("day 22 after day 21 sent does not backfill day 7 or 14", () => {
    assert.equal(
      resolveNextWarningMilestone(22, reclaimDays, new Set([21])),
      null,
    );
  });

  it("day 36 after only day 7 sent sends day 35 directly", () => {
    assert.equal(
      resolveNextWarningMilestone(36, reclaimDays, new Set([7])),
      35,
    );
  });

  it("does not repeat an already-sent highest applicable milestone", () => {
    assert.equal(
      resolveNextWarningMilestone(8, reclaimDays, new Set([7])),
      null,
    );
    assert.equal(
      resolveNextWarningMilestone(15, reclaimDays, new Set([14])),
      null,
    );
  });

  it("sends at most one periodic milestone per run", () => {
    const milestone = resolveNextWarningMilestone(28, reclaimDays, new Set());
    assert.equal(milestone, 28);
    assert.notEqual(milestone, 7);
    assert.notEqual(milestone, 14);
    assert.notEqual(milestone, 21);
  });

  it("new cycle with empty sent set recalculates from highest applicable node", () => {
    const oldCycleSent = new Set([7, 14, 21]);
    assert.equal(
      resolveNextWarningMilestone(22, reclaimDays, oldCycleSent),
      null,
    );
    assert.equal(resolveNextWarningMilestone(22, reclaimDays, new Set()), 21);
  });

  it("final warning window spans the last business day before reclaim", () => {
    assert.equal(isInFinalWarningWindow(43, reclaimDays), false);
    assert.equal(isInFinalWarningWindow(44, reclaimDays), true);
    assert.equal(isInFinalWarningWindow(45, reclaimDays), false);
    assert.equal(
      resolveNextWarningMilestone(44, reclaimDays, new Set([7, 14, 21, 28, 35, 42])),
      44,
    );
    assert.equal(
      resolveNextWarningMilestone(45, reclaimDays, new Set([7, 14, 21, 28, 35, 42])),
      null,
    );
  });

  it("final warning takes priority over periodic milestones", () => {
    assert.equal(
      resolveNextWarningMilestone(44, reclaimDays, new Set()),
      44,
    );
    assert.equal(
      resolveNextWarningMilestone(44, reclaimDays, new Set([7])),
      44,
    );
    assert.equal(
      resolveNextWarningMilestone(44, reclaimDays, new Set([7, 14, 21, 28, 35, 42])),
      44,
    );
  });

  it("does not backfill warnings after reclaim threshold", () => {
    assert.equal(
      resolveNextWarningMilestone(46, reclaimDays, new Set()),
      null,
    );
    assert.equal(
      resolveNextWarningMilestone(45, reclaimDays, new Set()),
      null,
    );
  });

  it("sequence numbers for periodic warnings", () => {
    assert.equal(getWarningSequenceNumber(7, reclaimDays), 1);
    assert.equal(getWarningSequenceNumber(14, reclaimDays), 2);
    assert.equal(getWarningSequenceNumber(44, reclaimDays), 0);
    assert.equal(isFinalReclamationWarning(44, reclaimDays), true);
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
