import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSafeDashboardAiHref,
  mapAdminPriorityHref,
  mapStaffCategoryHref,
  resolveDashboardAiLocale,
  toDashboardAiPublicResponse,
} from "./api-response";
import type { DashboardAiInsightResult } from "./types";

describe("dashboard AI public API response", () => {
  it("strips fingerprint, customerId, and customerRef from staff success", () => {
    const result: DashboardAiInsightResult = {
      status: "success",
      source: "provider",
      fingerprint: "secret-fingerprint",
      cacheHit: true,
      payload: {
        insightType: "staff_today_actions",
        insight: {
          headline: "Focus on overdue follow-ups",
          actions: [
            {
              customerRef: "C1",
              category: "overdue",
              title: "Call back",
              reason: "Overdue 4h",
              urgency: "urgent",
            },
          ],
        },
        resolvedActions: [
          {
            customerRef: "C1",
            category: "overdue",
            title: "Call back",
            reason: "Overdue 4h",
            urgency: "urgent",
            customerId: "cust-secret-id",
            customerHref: "/customers/cust-secret-id",
            customerDisplayLabel: "客户 1",
          },
        ],
      },
    };

    const pub = toDashboardAiPublicResponse(result);
    const json = JSON.stringify(pub);
    assert.equal(pub.status, "success");
    assert.equal(pub.source, "provider");
    assert.equal(pub.cached, true);
    assert.doesNotMatch(json, /fingerprint/);
    assert.doesNotMatch(json, /"customerId"/);
    assert.doesNotMatch(json, /customerRef/);
    assert.equal(pub.insight?.insightType, "staff_today_actions");
    if (pub.insight?.insightType !== "staff_today_actions") {
      throw new Error("expected staff insight");
    }
    assert.equal(pub.insight.actions[0]?.customer?.label, "客户 1");
    assert.equal(
      pub.insight.actions[0]?.customer?.href,
      "/customers/cust-secret-id",
    );
    assert.equal(
      "customerId" in (pub.insight.actions[0] as object),
      false,
    );
  });

  it("drops unsafe customer hrefs", () => {
    const result: DashboardAiInsightResult = {
      status: "success",
      source: "mock",
      payload: {
        insightType: "staff_today_actions",
        insight: { headline: "H", actions: [] },
        resolvedActions: [
          {
            category: "follow_up",
            title: "Bad link",
            reason: "x",
            urgency: "normal",
            customerHref: "javascript:alert(1)",
            customerDisplayLabel: "客户 1",
          },
          {
            category: "follow_up",
            title: "External",
            reason: "x",
            urgency: "normal",
            customerHref: "https://evil.example",
            customerDisplayLabel: "客户 2",
          },
        ],
      },
    };
    const pub = toDashboardAiPublicResponse(result);
    if (pub.insight?.insightType !== "staff_today_actions") {
      throw new Error("expected staff insight");
    }
    assert.equal(pub.insight.actions[0]?.customer, undefined);
    assert.equal(pub.insight.actions[1]?.customer, undefined);
  });

  it("marks system_fallback distinctly from provider", () => {
    const result: DashboardAiInsightResult = {
      status: "success",
      source: "system_fallback",
      payload: {
        insightType: "admin_management_brief",
        insight: {
          headline: "System summary",
          summary: "Based on counts",
          priorities: [],
          cautions: ["Watch pool"],
        },
      },
    };
    const pub = toDashboardAiPublicResponse(result);
    assert.equal(pub.source, "system_fallback");
    assert.notEqual(pub.source, "provider");
    assert.notEqual(pub.source, "mock");
  });

  it("passes through non-success statuses without insight", () => {
    for (const status of [
      "unavailable",
      "timeout",
      "rate_limited",
      "disabled",
      "invalid_response",
    ] as const) {
      const pub = toDashboardAiPublicResponse({
        status,
        message: "safe",
      });
      assert.equal(pub.status, status);
      assert.equal(pub.insight, undefined);
      assert.equal(pub.source, null);
    }
  });
});

describe("dashboard AI safe href helpers", () => {
  it("accepts only allowlisted internal paths", () => {
    assert.equal(isSafeDashboardAiHref("/customers/abc-123"), true);
    assert.equal(isSafeDashboardAiHref("/customers?reclamationRisk=mine"), true);
    assert.equal(isSafeDashboardAiHref("/work-items"), true);
    assert.equal(isSafeDashboardAiHref("/approvals"), true);
    assert.equal(isSafeDashboardAiHref("/public-pool"), true);
    assert.equal(isSafeDashboardAiHref("https://example.com"), false);
    assert.equal(isSafeDashboardAiHref("javascript:alert(1)"), false);
    assert.equal(isSafeDashboardAiHref("//evil"), false);
    assert.equal(isSafeDashboardAiHref("/admin/users"), false);
  });

  it("maps categories to fixed hrefs", () => {
    assert.equal(mapAdminPriorityHref("approvals"), "/approvals");
    assert.equal(
      mapAdminPriorityHref("reclamation"),
      "/customers?reclamationRisk=team",
    );
    assert.equal(mapStaffCategoryHref("reclamation"), "/customers?reclamationRisk=mine");
    assert.equal(mapStaffCategoryHref("overdue"), "/customers?workView=overdue");
  });

  it("resolves only supported locales", () => {
    assert.equal(resolveDashboardAiLocale("zh-Hans"), "zh-Hans");
    assert.equal(resolveDashboardAiLocale("zh-Hant"), "zh-Hant");
    assert.equal(resolveDashboardAiLocale("en"), "en");
    assert.equal(resolveDashboardAiLocale("fr"), "en");
    assert.equal(resolveDashboardAiLocale(null), "en");
  });
});
