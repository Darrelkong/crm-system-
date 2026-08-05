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

  it("is stable regardless of object field order in counts", () => {
    const a = buildSummaryFingerprint({
      summaryScope: "admin_team",
      counts: { ...baseCounts },
    });
    const b = buildSummaryFingerprint({
      summaryScope: "admin_team",
      counts: {
        routineCount: 1,
        earliestReleaseAt: "2026-08-10T00:00:00.000Z",
        within14Count: 0,
        within7Count: 1,
        tomorrowCount: 1,
        totalCount: 3,
        memberCount: 2,
      },
    });
    assert.equal(a, b);
  });

  it("changes when tomorrow count changes", () => {
    const before = buildSummaryFingerprint({
      summaryScope: "staff_self",
      counts: baseCounts,
    });
    const after = buildSummaryFingerprint({
      summaryScope: "staff_self",
      counts: { ...baseCounts, tomorrowCount: 2, totalCount: 4 },
    });
    assert.notEqual(before, after);
  });

  it("changes when severity band changes", () => {
    const routine = buildSummaryFingerprint({
      summaryScope: "staff_self",
      counts: {
        totalCount: 1,
        tomorrowCount: 0,
        within7Count: 0,
        within14Count: 0,
        routineCount: 1,
        earliestReleaseAt: "2026-09-01T00:00:00.000Z",
      },
    });
    const urgent = buildSummaryFingerprint({
      summaryScope: "staff_self",
      counts: {
        totalCount: 1,
        tomorrowCount: 0,
        within7Count: 1,
        within14Count: 0,
        routineCount: 0,
        earliestReleaseAt: "2026-09-01T00:00:00.000Z",
      },
    });
    assert.notEqual(routine, urgent);
  });
});
