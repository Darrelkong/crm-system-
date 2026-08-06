import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StaffCustomerRefMap } from "./customer-ref";
import { validateDashboardAiProviderOutput } from "./validate-output";

describe("dashboard AI customer ref mapping", () => {
  it("maps authorized refs and drops unknown refs", () => {
    const refMap = new StaffCustomerRefMap([
      "11111111-1111-1111-1111-111111111101",
      "11111111-1111-1111-1111-111111111102",
    ]);

    const validated = validateDashboardAiProviderOutput(
      "staff_today_actions",
      {
        headline: "Today",
        actions: [
          {
            customerRef: "C1",
            category: "overdue",
            title: "Follow up C1",
            reason: "Overdue",
            urgency: "urgent",
          },
          {
            customerRef: "C9",
            category: "overdue",
            title: "Bad ref",
            reason: "Should drop",
            urgency: "urgent",
          },
        ],
      },
      refMap,
    );

    assert.equal(validated.ok, true);
    if (!validated.ok || validated.payload.insightType !== "staff_today_actions") {
      throw new Error("expected staff payload");
    }
    assert.equal(validated.payload.insight.actions.length, 1);
    assert.equal(validated.payload.resolvedActions?.[0]?.customerId, "11111111-1111-1111-1111-111111111101");
    assert.equal(
      validated.payload.resolvedActions?.[0]?.customerDisplayLabel,
      "客户 1",
    );
  });
});
