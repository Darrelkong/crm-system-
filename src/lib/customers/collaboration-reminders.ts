import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { buildCreateNotificationStatement } from "@/lib/notifications/service";

export const COLLABORATION_REMINDER_INTERVAL_DAYS = 10;
const INTERVAL_MS =
  COLLABORATION_REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
export const COLLABORATION_REMINDER_NOTIFICATION_TYPE =
  "customer.collaboration_follow_up_reminder" as const;

export type CollaborationReminderCandidate = {
  customerId: string;
  customerName: string;
  ownerId: string;
  collaboratorIds: string[];
  lastParticipantFollowUpAt: string | null;
  anchorAt: string;
  daysWithoutFollowUp: number;
  intervalNumber: number;
  groupingKey: string;
};

type CustomerRow = {
  id: string;
  customerName: string;
  ownerId: string | null;
  createdAt: string;
};

function latestIso(values: string[]): string | null {
  return values.length > 0
    ? values.reduce((latest, value) =>
        value > latest ? value : latest,
      )
    : null;
}

export async function listCollaborationReminderCandidates(
  db: Database,
  now = new Date(),
): Promise<CollaborationReminderCandidate[]> {
  const customers = (await db
    .select({
      id: schema.customers.id,
      customerName: schema.customers.customerName,
      ownerId: schema.customers.ownerId,
      createdAt: schema.customers.createdAt,
    })
    .from(schema.customers)
    .where(eq(schema.customers.status, "active"))) as CustomerRow[];

  const customerIds = customers
    .filter((customer) => customer.ownerId)
    .map((customer) => customer.id);
  if (customerIds.length === 0) return [];

  const customerBatches: string[][] = [];
  for (let index = 0; index < customerIds.length; index += 50) {
    customerBatches.push(customerIds.slice(index, index + 50));
  }
  const [collaboratorBatches, followUpBatches] = await Promise.all([
    Promise.all(
      customerBatches.map((batch) =>
        db
          .select({
            customerId: schema.customerAssignees.customerId,
            userId: schema.customerAssignees.userId,
          })
          .from(schema.customerAssignees)
          .where(
            and(
              inArray(schema.customerAssignees.customerId, batch),
              eq(schema.customerAssignees.role, "collaborator"),
            ),
          ),
      ),
    ),
    Promise.all(
      customerBatches.map((batch) =>
        db
          .select({
            customerId: schema.followUps.customerId,
            userId: schema.followUps.userId,
            followUpTime: schema.followUps.followUpTime,
          })
          .from(schema.followUps)
          .where(
            and(
              inArray(schema.followUps.customerId, batch),
              eq(schema.followUps.isValidFollowUp, 1),
            ),
          ),
      ),
    ),
  ]);
  const collaboratorRows = collaboratorBatches.flat();
  const followUpRows = followUpBatches.flat();

  const collaboratorsByCustomer = new Map<string, string[]>();
  for (const row of collaboratorRows) {
    const ids = collaboratorsByCustomer.get(row.customerId) ?? [];
    ids.push(row.userId);
    collaboratorsByCustomer.set(row.customerId, ids);
  }
  const followUpsByCustomerAndUser = new Map<string, string[]>();
  for (const row of followUpRows) {
    const key = `${row.customerId}:${row.userId}`;
    const times = followUpsByCustomerAndUser.get(key) ?? [];
    times.push(row.followUpTime);
    followUpsByCustomerAndUser.set(key, times);
  }

  const result: CollaborationReminderCandidate[] = [];
  for (const customer of customers) {
    if (!customer.ownerId) continue;
    const collaboratorIds = collaboratorsByCustomer.get(customer.id) ?? [];
    if (collaboratorIds.length === 0) continue;

    const participantIds = [customer.ownerId, ...collaboratorIds];
    const participantFollowUps = participantIds.flatMap(
      (userId) =>
        followUpsByCustomerAndUser.get(`${customer.id}:${userId}`) ?? [],
    );
    const lastParticipantFollowUpAt = latestIso(participantFollowUps);
    const anchorAt = lastParticipantFollowUpAt ?? customer.createdAt;
    const elapsed = now.getTime() - new Date(anchorAt).getTime();
    const daysWithoutFollowUp = Math.max(
      0,
      Math.floor(elapsed / (24 * 60 * 60 * 1000)),
    );
    const intervalNumber = Math.floor(elapsed / INTERVAL_MS);
    if (intervalNumber < 1) continue;

    result.push({
      customerId: customer.id,
      customerName: customer.customerName,
      ownerId: customer.ownerId,
      collaboratorIds,
      lastParticipantFollowUpAt,
      anchorAt,
      daysWithoutFollowUp,
      intervalNumber,
      groupingKey: `customer-collaboration-reminder:${customer.id}:${anchorAt}:${intervalNumber}`,
    });
  }

  return result;
}

export type CollaborationReminderRunResult = {
  candidateCount: number;
  notificationCount: number;
};

/**
 * Daily idempotent reminder delivery. It only inserts notifications and never
 * updates customers, assignees, approvals, ownership, or pool state.
 */
export async function runCollaborationFollowUpReminderCheck(
  db: Database,
  now = new Date(),
): Promise<CollaborationReminderRunResult> {
  const candidates = await listCollaborationReminderCandidates(db, now);
  let notificationCount = 0;

  for (const candidate of candidates) {
    const recipientIds = [
      candidate.ownerId,
      ...candidate.collaboratorIds,
    ];
    const existing = await db
      .select({ userId: schema.notifications.userId })
      .from(schema.notifications)
      .where(
        and(
          eq(
            schema.notifications.type,
            COLLABORATION_REMINDER_NOTIFICATION_TYPE,
          ),
          eq(schema.notifications.relatedEntityType, "customer"),
          eq(schema.notifications.relatedEntityId, candidate.customerId),
          eq(schema.notifications.groupingKey, candidate.groupingKey),
          inArray(schema.notifications.userId, recipientIds),
        ),
      );
    const existingIds = new Set(existing.map((row) => row.userId));
    const createdAt = now.toISOString();
    const statements = recipientIds
      .filter((userId) => !existingIds.has(userId))
      .map((userId) =>
        buildCreateNotificationStatement(db, {
          id: crypto.randomUUID(),
          userId,
          type: COLLABORATION_REMINDER_NOTIFICATION_TYPE,
          titleKey:
            "notificationTypes.customer_collaboration_follow_up_reminder",
          messageKey: "notificationMessages.collaborationFollowUpReminder",
          messageParams: { customerName: candidate.customerName },
          relatedEntityType: "customer",
          relatedEntityId: candidate.customerId,
          groupingKey: candidate.groupingKey,
          createdAt,
        }),
      );

    if (statements.length > 0) {
      await db.batch(
        statements as unknown as Parameters<Database["batch"]>[0],
      );
      notificationCount += statements.length;
    }
  }

  return { candidateCount: candidates.length, notificationCount };
}
