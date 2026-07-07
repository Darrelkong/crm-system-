import { and, eq } from "drizzle-orm";
import type { Customer } from "../../../drizzle/schema/customers";
import type { NotificationType } from "../../../drizzle/schema/notifications";
import { shouldShowPendingSecondConversionBadge } from "@/lib/customers/sales-stage-badges";
import type { CompleteCustomerLifecycleResult } from "@/lib/customers/lifecycle-complete";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { createNotification } from "./service";

export const PENDING_SECOND_CONVERSION_NOTIFICATION_TYPE =
  "customer.pending_second_conversion" satisfies NotificationType;

export type NotifyPendingSecondConversionInput = {
  id: string;
  customerName: string;
  lifecycleStatus?: string | null;
  status: string;
  ownerId?: string | null;
  deletedAt?: string | null;
  isArchived?: boolean;
};

export async function hasPendingSecondConversionNotification(
  db: Database,
  userId: string,
  customerId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(
          schema.notifications.type,
          PENDING_SECOND_CONVERSION_NOTIFICATION_TYPE,
        ),
        eq(schema.notifications.relatedEntityType, "customer"),
        eq(schema.notifications.relatedEntityId, customerId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export async function notifyPendingSecondConversionIfEligible(
  db: Database,
  input: NotifyPendingSecondConversionInput,
): Promise<string | null> {
  if (
    !shouldShowPendingSecondConversionBadge({
      lifecycleStatus: input.lifecycleStatus,
      status: input.status,
      isArchived: input.isArchived,
      deletedAt: input.deletedAt,
    })
  ) {
    return null;
  }

  const ownerId = input.ownerId?.trim();
  if (!ownerId) {
    return null;
  }

  if (await hasPendingSecondConversionNotification(db, ownerId, input.id)) {
    return null;
  }

  return createNotification(db, {
    userId: ownerId,
    type: PENDING_SECOND_CONVERSION_NOTIFICATION_TYPE,
    titleKey: "notificationTypes.customer_pending_second_conversion",
    messageKey: "notificationMessages.pendingSecondConversion",
    messageParams: { customerName: input.customerName },
    relatedEntityType: "customer",
    relatedEntityId: input.id,
  });
}

function toNotifyInput(
  customer: Customer,
  result: CompleteCustomerLifecycleResult,
): NotifyPendingSecondConversionInput {
  return {
    id: customer.id,
    customerName: customer.customerName,
    lifecycleStatus: result.lifecycleStatus,
    status: result.status,
    ownerId: customer.ownerId,
    deletedAt: customer.deletedAt,
    isArchived: customer.status === "archived",
  };
}

type NotifyPendingSecondConversionFn = typeof notifyPendingSecondConversionIfEligible;

/**
 * Post-lifecycle-complete side effect. Notification failures must not fail the API.
 */
export async function safelyNotifyPendingSecondConversionAfterLifecycleComplete(
  db: Database,
  customer: Customer,
  result: CompleteCustomerLifecycleResult,
  deps: {
    notify?: NotifyPendingSecondConversionFn;
  } = {},
): Promise<void> {
  const notify = deps.notify ?? notifyPendingSecondConversionIfEligible;

  try {
    await notify(db, toNotifyInput(customer, result));
  } catch (error) {
    console.warn(
      "[lifecycle-complete] pending second conversion notification failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
