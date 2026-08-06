import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  safeParseAdminBriefInsight,
  safeParseStaffTodayActionsInsight,
} from "./schemas";

describe("dashboard AI output schemas", () => {
  it("accepts valid admin brief JSON", () => {
    const parsed = safeParseAdminBriefInsight({
      headline: "Team focus",
      summary: "Based on current dashboard data.",
      priorities: [
        {
          category: "approvals",
          title: "Review approvals",
          reason: "3 pending approvals.",
          urgency: "attention",
        },
      ],
      cautions: ["Advisory only."],
    });
    assert.equal(parsed.success, true);
  });

  it("rejects HTML and external URLs", () => {
    const parsed = safeParseAdminBriefInsight({
      headline: "<script>alert(1)</script>",
      summary: "Visit https://evil.example",
      priorities: [],
      cautions: [],
    });
    assert.equal(parsed.success, false);
  });

  it("rejects unknown customer refs for staff actions", () => {
    const parsed = safeParseStaffTodayActionsInsight({
      headline: "Today",
      actions: [
        {
          customerRef: "X9",
          category: "overdue",
          title: "Follow up",
          reason: "Overdue",
          urgency: "urgent",
        },
      ],
    });
    assert.equal(parsed.success, false);
  });

  it("accepts valid staff action refs", () => {
    const parsed = safeParseStaffTodayActionsInsight({
      headline: "Today",
      actions: [
        {
          customerRef: "C1",
          category: "overdue",
          title: "Follow up",
          reason: "Overdue",
          urgency: "urgent",
        },
      ],
    });
    assert.equal(parsed.success, true);
  });
});
