import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSummaryFingerprint } from "./summary-fingerprint";

describe("summary fingerprint", () => {
  const baseCounts = {
    totalCount: 3,
    tomorrowCount: 1,
    within7Count: 1,
    within14Count: 0,
    routineCount: 1,
    earliestReleaseAt: "2026-08-10T00:00:00.000Z",
    memberCount: 2,
  };

  const keys = [
    "a:owner:cycle:14:v1",
    "b:owner:cycle:14:v1",
    "c:owner:cycle:14:v1",
  ];

  it("is stable for the same canonical risk set", () => {
    const a = buildSummaryFingerprint({
      summaryScope: "admin_team",
      recipientUserId: "admin-1",
      riskEpisodeKeys: keys,
      counts: baseCounts,
    });
    const b = buildSummaryFingerprint({
      summaryScope: "admin_team",
      recipientUserId: "admin-1",
      riskEpisodeKeys: [...keys].reverse(),
      counts: baseCounts,
    });
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
  });

  it("changes when tomorrow count changes", () => {
    const before = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: "staff-1",
      riskEpisodeKeys: keys.slice(0, 1),
      counts: baseCounts,
    });
    const after = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: "staff-1",
      riskEpisodeKeys: keys.slice(0, 1),
      counts: { ...baseCounts, tomorrowCount: 2, totalCount: 4 },
    });
    assert.notEqual(before, after);
  });
});
