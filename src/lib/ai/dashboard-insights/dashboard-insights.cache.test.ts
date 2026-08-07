import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildDashboardAiCacheKey,
  clearDashboardAiCacheForTests,
  getDashboardAiCache,
  setDashboardAiCache,
} from "./cache";
import { buildDashboardAiContextFingerprint } from "./fingerprint";
import {
  bestEffortLocalThrottleDashboardAi,
  clearDashboardAiLocalThrottleForTests,
} from "./best-effort-local-throttle";

describe("dashboard AI cache and fingerprint", () => {
  afterEach(() => {
    clearDashboardAiCacheForTests();
    clearDashboardAiLocalThrottleForTests();
  });

  it("isolates cache keys by user and insight type", () => {
    const fingerprint = buildDashboardAiContextFingerprint({
      viewerRole: "staff",
      viewerId: "user-a",
      insightType: "staff_today_actions",
      locale: "en",
      context: { metrics: { overdueFollowUps: 1 } },
    });
    const keyA = buildDashboardAiCacheKey({
      viewerId: "user-a",
      viewerRole: "staff",
      insightType: "staff_today_actions",
      locale: "en",
      fingerprint,
    });
    const keyB = buildDashboardAiCacheKey({
      viewerId: "user-b",
      viewerRole: "staff",
      insightType: "staff_today_actions",
      locale: "en",
      fingerprint,
    });
    setDashboardAiCache(keyA, { status: "success", payload: undefined });
    assert.equal(getDashboardAiCache(keyB), null);
  });

  it("changes fingerprint when context changes", () => {
    const base = {
      viewerRole: "admin",
      viewerId: "admin-1",
      insightType: "admin_management_brief" as const,
      locale: "en",
    };
    const a = buildDashboardAiContextFingerprint({
      ...base,
      context: { metrics: { overdueFollowUps: 1 } },
    });
    const b = buildDashboardAiContextFingerprint({
      ...base,
      context: { metrics: { overdueFollowUps: 2 } },
    });
    assert.notEqual(a, b);
  });

  it("best-effort local throttle limits repeated requests per user", () => {
    const first = bestEffortLocalThrottleDashboardAi(
      "staff-1",
      "staff_today_actions",
      0,
    );
    const second = bestEffortLocalThrottleDashboardAi(
      "staff-1",
      "staff_today_actions",
      1,
    );
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, false);
  });
});
