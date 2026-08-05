import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTIONABLE_NOTIFICATION_TYPES,
  defaultActionStateForType,
  isActionableNotificationType,
  isBulkMarkReadEligible,
  isLegacyPerCustomerReclaimWarningType,
  NOTIFICATION_ACTION_STATE,
  staffReclamationGroupingKey,
  adminReclamationGroupingKey,
} from "./action-state";
import { NOTIFICATION_TYPES } from "../../../drizzle/schema/notifications";
import {
  classifyReclamationRiskBand,
} from "@/lib/reclamation/risk-snapshot";

describe("notification action state helpers", () => {
  it("defaults approval.pending to pending", () => {
    assert.equal(
      defaultActionStateForType("approval.pending"),
      NOTIFICATION_ACTION_STATE.pending,
    );
  });

  it("defaults reclamation summaries to pending", () => {
    assert.equal(
      defaultActionStateForType("reclamation.summary.staff"),
      NOTIFICATION_ACTION_STATE.pending,
    );
  });

  it("defaults informational types", () => {
    assert.equal(
      defaultActionStateForType("customer.transferred"),
      NOTIFICATION_ACTION_STATE.informational,
    );
    assert.equal(
      defaultActionStateForType("approval.approved"),
      NOTIFICATION_ACTION_STATE.informational,
    );
    assert.equal(
      defaultActionStateForType("customer_auto_reclaimed"),
      NOTIFICATION_ACTION_STATE.informational,
    );
  });

  it("marks all actionable notification types as pending", () => {
    for (const type of ACTIONABLE_NOTIFICATION_TYPES) {
      assert.equal(
        defaultActionStateForType(type),
        NOTIFICATION_ACTION_STATE.pending,
        type,
      );
      assert.equal(isActionableNotificationType(type), true, type);
    }

    for (const type of NOTIFICATION_TYPES) {
      if ((ACTIONABLE_NOTIFICATION_TYPES as readonly string[]).includes(type)) {
        continue;
      }
      assert.equal(
        defaultActionStateForType(type),
        NOTIFICATION_ACTION_STATE.informational,
        type,
      );
    }
  });

  it("bulk mark read excludes pending only", () => {
    assert.equal(isBulkMarkReadEligible("informational"), true);
    assert.equal(isBulkMarkReadEligible("completed"), true);
    assert.equal(isBulkMarkReadEligible("expired"), true);
    assert.equal(isBulkMarkReadEligible("pending"), false);
  });

  it("uses stable grouping keys", () => {
    const userId = "11111111-1111-1111-1111-111111111102";
    assert.equal(staffReclamationGroupingKey(userId), `reclamation:staff:${userId}`);
    assert.equal(adminReclamationGroupingKey(), "reclamation:admin:team");
  });

  it("hides legacy per-customer reclaim warning types", () => {
    assert.equal(isLegacyPerCustomerReclaimWarningType("auto_reclaim_warning_day_6"), true);
    assert.equal(isLegacyPerCustomerReclaimWarningType("reclamation.summary.staff"), false);
  });
});

describe("reclamation risk band classification", () => {
  const reclaimDays = 45;

  it("classifies tomorrow, within 7, within 14, and routine", () => {
    assert.equal(classifyReclamationRiskBand(44, reclaimDays), "tomorrow");
    assert.equal(classifyReclamationRiskBand(40, reclaimDays), "within_7");
    assert.equal(classifyReclamationRiskBand(33, reclaimDays), "within_14");
    assert.equal(classifyReclamationRiskBand(10, reclaimDays), "routine");
    assert.equal(classifyReclamationRiskBand(6, reclaimDays), null);
  });
});
