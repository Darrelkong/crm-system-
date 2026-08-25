import { and, desc, eq } from "drizzle-orm";
import type { MailNotificationAttemptState } from "../../../drizzle/schema/mail-notification-attempts";
import type { MailNotificationOutboxStatus } from "../../../drizzle/schema/mail-notification-outbox";
import type { MailNotificationType } from "../../../drizzle/schema/mail-notification-outbox";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import { assertMailNotificationProofManagement } from "@/lib/permissions/mail";

/** Admin-safe notification proof run view — no PII or transport secrets. */
export type NotificationProofRunAdminView = {
  sourceEntityId: string;
  notificationType: MailNotificationType;
  outboxStatus: MailNotificationOutboxStatus;
  attemptStatus: MailNotificationAttemptState | null;
  providerId: string | null;
  createdAt: string;
  completedAt: string | null;
  attemptCompletedAt: string | null;
};

const PROOF_RUN_SECRET_FIELD_NAMES = [
  "recipientUserId",
  "notificationIdentityId",
  "providerRequestId",
  "verificationToken",
  "email",
  "body",
  "subject",
  "errorMessage",
  "errorCode",
  "failureCode",
  "mailboxId",
  "outboxId",
  "id",
] as const;

export function assertNotificationProofRunResponseHasNoSecrets(
  payload: unknown,
): void {
  const json = JSON.stringify(payload);
  for (const field of PROOF_RUN_SECRET_FIELD_NAMES) {
    if (json.includes(`"${field}"`)) {
      throw new Error(`Secret or sensitive field leaked in response: ${field}`);
    }
  }
}

async function findLatestAttemptForOutbox(
  db: Database,
  outboxId: string,
): Promise<{
  state: MailNotificationAttemptState;
  provider: string;
  completedAt: string | null;
} | null> {
  const [row] = await db
    .select({
      state: schema.mailNotificationAttempts.state,
      provider: schema.mailNotificationAttempts.provider,
      completedAt: schema.mailNotificationAttempts.completedAt,
      attemptNumber: schema.mailNotificationAttempts.attemptNumber,
    })
    .from(schema.mailNotificationAttempts)
    .where(eq(schema.mailNotificationAttempts.notificationOutboxId, outboxId))
    .orderBy(desc(schema.mailNotificationAttempts.attemptNumber))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    state: row.state,
    provider: row.provider,
    completedAt: row.completedAt,
  };
}

export function toNotificationProofRunAdminView(input: {
  sourceEntityId: string;
  notificationType: MailNotificationType;
  outboxStatus: MailNotificationOutboxStatus;
  enqueuedAt: string;
  completedAt: string | null;
  latestAttempt: {
    state: MailNotificationAttemptState;
    provider: string;
    completedAt: string | null;
  } | null;
}): NotificationProofRunAdminView {
  return {
    sourceEntityId: input.sourceEntityId,
    notificationType: input.notificationType,
    outboxStatus: input.outboxStatus,
    attemptStatus: input.latestAttempt?.state ?? null,
    providerId: input.latestAttempt?.provider ?? null,
    createdAt: input.enqueuedAt,
    completedAt: input.completedAt,
    attemptCompletedAt: input.latestAttempt?.completedAt ?? null,
  };
}

/**
 * Lists self notification proof outbox runs for super_admin proof diagnostics.
 * Recipient scope is always the authenticated actor (same as proof enqueue).
 */
export async function listNotificationProofRunsForAdmin(
  db: Database,
  actor: MailActorContext,
  input?: { limit?: number },
): Promise<NotificationProofRunAdminView[]> {
  assertMailNotificationProofManagement(actor);

  const limit = input?.limit ?? 50;
  const outboxRows = await db
    .select({
      id: schema.mailNotificationOutbox.id,
      sourceEntityId: schema.mailNotificationOutbox.sourceEntityId,
      notificationType: schema.mailNotificationOutbox.notificationType,
      status: schema.mailNotificationOutbox.status,
      enqueuedAt: schema.mailNotificationOutbox.enqueuedAt,
      completedAt: schema.mailNotificationOutbox.completedAt,
    })
    .from(schema.mailNotificationOutbox)
    .where(
      and(
        eq(schema.mailNotificationOutbox.recipientUserId, actor.userId),
        eq(
          schema.mailNotificationOutbox.sourceEntityType,
          MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
        ),
      ),
    )
    .orderBy(desc(schema.mailNotificationOutbox.enqueuedAt))
    .limit(limit);

  const results: NotificationProofRunAdminView[] = [];
  for (const row of outboxRows) {
    const latestAttempt = await findLatestAttemptForOutbox(db, row.id);
    results.push(
      toNotificationProofRunAdminView({
        sourceEntityId: row.sourceEntityId,
        notificationType: row.notificationType,
        outboxStatus: row.status,
        enqueuedAt: row.enqueuedAt,
        completedAt: row.completedAt,
        latestAttempt,
      }),
    );
  }
  return results;
}
