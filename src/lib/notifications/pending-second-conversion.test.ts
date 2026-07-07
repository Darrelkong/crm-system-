import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import type { CompleteCustomerLifecycleResult } from "@/lib/customers/lifecycle-complete";
import { CUSTOMER_LIFECYCLE_COMPLETED } from "@/lib/customers/lifecycle-complete";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { safelyNotifyPendingSecondConversionAfterLifecycleComplete } from "./pending-second-conversion";

const customer = {
  id: "33333333-3333-3333-3333-333333333301",
  customerName: "通知测试客户",
  ownerId: SEED_IDS.staffA,
  deletedAt: null,
  status: "active",
} as Customer;

const result: CompleteCustomerLifecycleResult = {
  id: customer.id,
  lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
  lifecycleCompletedAt: "2026-07-08T16:00:00.000Z",
  lifecycleCompletedBy: SEED_IDS.admin,
  lifecycleCompletionNotes: null,
  salesStage: "paid",
  status: "active",
};

describe("safelyNotifyPendingSecondConversionAfterLifecycleComplete", () => {
  it("calls notify helper after lifecycle complete", async () => {
    let called = false;
    let receivedCustomerId: string | undefined;

    await safelyNotifyPendingSecondConversionAfterLifecycleComplete(
      {} as never,
      customer,
      result,
      {
        notify: async (_db, input) => {
          called = true;
          receivedCustomerId = input.id;
          return ["notification-id"];
        },
      },
    );

    assert.equal(called, true);
    assert.equal(receivedCustomerId, customer.id);
  });

  it("does not throw when notify helper fails", async () => {
    await assert.doesNotReject(async () => {
      await safelyNotifyPendingSecondConversionAfterLifecycleComplete(
        {} as never,
        customer,
        result,
        {
          notify: async () => {
            throw new Error("notification insert failed");
          },
        },
      );
    });
  });
});
