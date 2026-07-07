import { and, eq, inArray } from "drizzle-orm";
import type { Customer } from "../../../drizzle/schema/customers";
import type { NotificationType } from "../../../drizzle/schema/notifications";
import { listCustomerAssignees } from "@/lib/customers/assignees";
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

export async function resolvePendingSecondConversionRecipients(
  db: Database,
  customerId: string,
  ownerId?: string | null,
): Promise<string[]> {
  const assignees = await listCustomerAssignees(db, customerId);
  const candidateUserIds = new Set<string>();

  const trimmedOwnerId = ownerId?.trim();
  if (trimmedOwnerId) {
    candidateUserIds.add(trimmedOwnerId);
  }

  for (const assignee of assignees) {
    candidateUserIds.add(assignee.userId);
  }

  if (candidateUserIds.size === 0) {
    return [];
  }

  const users = await db
    .select({
      id: schema.users.id,
      role: schema.users.role,
      isActive: schema.users.isActive,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, [...candidateUserIds]));

  const eligibleRecipients = new Set<string>();
  for (const user of users) {
    if (
      user.role === "staff" &&
      user.isActive === 1 &&
      user.deletedAt == null
    ) {
      eligibleRecipients.add(user.id);
    }
  }

  return [...eligibleRecipients];
}

export async function notifyPendingSecondConversionIfEligible(
  db: Database,
  input: NotifyPendingSecondConversionInput,
): Promise<string[]> {
  if (
    !shouldShowPendingSecondConversionBadge({
      lifecycleStatus: input.lifecycleStatus,
      status: input.status,
      isArchived: input.isArchived,
      deletedAt: input.deletedAt,
    })
  ) {
    return [];
  }

  const recipients = await resolvePendingSecondConversionRecipients(
    db,
    input.id,
    input.ownerId,
  );

  if (recipients.length === 0) {
    return [];
  }

  const createdNotificationIds: string[] = [];

  for (const userId of recipients) {
    if (await hasPendingSecondConversionNotification(db, userId, input.id)) {
      continue;
    }

    const notificationId = await createNotification(db, {
      userId,
      type: PENDING_SECOND_CONVERSION_NOTIFICATION_TYPE,
      titleKey: "notificationTypes.customer_pending_second_conversion",
      messageKey: "notificationMessages.pendingSecondConversion",
      messageParams: { customerName: input.customerName },
      relatedEntityType: "customer",
      relatedEntityId: input.id,
    });

    createdNotificationIds.push(notificationId);
  }

  return createdNotificationIds;
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
