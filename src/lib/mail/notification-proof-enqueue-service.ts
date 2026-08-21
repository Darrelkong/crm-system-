import { and, eq, gte, or, sql } from "drizzle-orm";
import type { MailNotificationOutboxStatus } from "../../../drizzle/schema/mail-notification-outbox";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  buildNotificationOutboxAuditInsert,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import { findActiveVerifiedNotificationIdentity } from "@/lib/mail/notification-identity-service";
import { enqueueMailNotificationIntent } from "@/lib/mail/notification-outbox-enqueue-service";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import { assertMailNotificationProofManagement } from "@/lib/permissions/mail";

export const NOTIFICATION_PROOF_SOURCE_ENTITY_ID_PREFIX =
  "proof-2c12c3a-h3-" as const;

export const NOTIFICATION_PROOF_RATE_LIMIT_MAX = 3 as const;
export const NOTIFICATION_PROOF_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type NotificationProofEnqueueResult = {
  outboxId: string;
  created: boolean;
  status: MailNotificationOutboxStatus;
  notificationType: "new_incoming";
  sourceEntityType: typeof MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof;
  sourceEntityId: string;
  recipientUserId: string;
  notificationIdentityId: string;
  enqueuedAt: string;
};

function buildProofSourceEntityId(): string {
  return `${NOTIFICATION_PROOF_SOURCE_ENTITY_ID_PREFIX}${crypto.randomUUID()}`;
}

async function assertRecipientMailAccessEnabled(
  db: Database,
  recipientUserId: string,
): Promise<void> {
  const [row] = await db
    .select({ isEnabled: schema.mailUserAccess.isEnabled })
    .from(schema.mailUserAccess)
    .where(eq(schema.mailUserAccess.userId, recipientUserId))
    .limit(1);
  if (row?.isEnabled !== 1) {
    throw MailServiceError.validation(
      "Mail access must be enabled before notification proof enqueue",
    );
  }
}

async function assertNoActiveProofOutbox(
  db: Database,
  recipientUserId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: schema.mailNotificationOutbox.id })
    .from(schema.mailNotificationOutbox)
    .where(
      and(
        eq(schema.mailNotificationOutbox.recipientUserId, recipientUserId),
        eq(
          schema.mailNotificationOutbox.sourceEntityType,
          MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
        ),
        or(
          eq(schema.mailNotificationOutbox.status, "pending"),
          eq(schema.mailNotificationOutbox.status, "processing"),
        ),
      ),
    )
    .limit(1);
  if (row) {
    throw MailServiceError.conflict(
      "An active notification proof outbox entry already exists for this user",
    );
  }
}

async function assertProofRateLimit(
  db: Database,
  recipientUserId: string,
  nowMs: number,
): Promise<void> {
  const windowStart = new Date(
    nowMs - NOTIFICATION_PROOF_RATE_LIMIT_WINDOW_MS,
  ).toISOString();
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(schema.mailNotificationOutbox)
    .where(
      and(
        eq(schema.mailNotificationOutbox.recipientUserId, recipientUserId),
        eq(
          schema.mailNotificationOutbox.sourceEntityType,
          MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
        ),
        gte(schema.mailNotificationOutbox.enqueuedAt, windowStart),
      ),
    );
  if ((row?.count ?? 0) >= NOTIFICATION_PROOF_RATE_LIMIT_MAX) {
    throw MailServiceError.conflict(
      "Notification proof enqueue rate limit exceeded for the last 24 hours",
    );
  }
}

function toProofEnqueueResult(
  outbox: {
    id: string;
    status: MailNotificationOutboxStatus;
    sourceEntityId: string;
    recipientUserId: string;
    notificationIdentityId: string;
    enqueuedAt: string;
  },
  created: boolean,
): NotificationProofEnqueueResult {
  return {
    outboxId: outbox.id,
    created,
    status: outbox.status,
    notificationType: "new_incoming",
    sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
    sourceEntityId: outbox.sourceEntityId,
    recipientUserId: outbox.recipientUserId,
    notificationIdentityId: outbox.notificationIdentityId,
    enqueuedAt: outbox.enqueuedAt,
  };
}

/**
 * Admin self-proof notification intent enqueue — no transport side effects.
 * Recipient is always the authenticated super_admin actor.
 */
export async function enqueueNotificationProofForAdmin(
  db: Database,
  actor: MailActorContext,
  options?: { nowMs?: number },
): Promise<NotificationProofEnqueueResult> {
  assertMailNotificationProofManagement(actor);

  const recipientUserId = actor.userId;
  await assertRecipientMailAccessEnabled(db, recipientUserId);

  const identity = await findActiveVerifiedNotificationIdentity(
    db,
    recipientUserId,
  );
  if (!identity) {
    throw MailServiceError.validation(
      "Verified notification identity is required before proof enqueue",
    );
  }
  if (identity.deliveryHealth === "bounced") {
    throw MailServiceError.validation(
      "Notification identity delivery health blocks proof enqueue",
    );
  }

  const nowMs = options?.nowMs ?? Date.now();
  await assertNoActiveProofOutbox(db, recipientUserId);
  await assertProofRateLimit(db, recipientUserId, nowMs);

  const sourceEntityId = buildProofSourceEntityId();
  const { outbox, created } = await enqueueMailNotificationIntent(db, {
    notificationType: "new_incoming",
    recipientUserId,
    notificationIdentityId: identity.id,
    sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
    sourceEntityId,
    mailboxId: null,
  });

  const now = new Date(nowMs).toISOString();
  await runMailBatch(db, [
    buildNotificationOutboxAuditInsert(db, actor, {
      auditId: crypto.randomUUID(),
      now,
      action: MAIL_AUDIT_ACTIONS.notificationProofEnqueued,
      outboxId: outbox.id,
      metadata: {
        outboxId: outbox.id,
        sourceEntityType: outbox.sourceEntityType,
        sourceEntityId: outbox.sourceEntityId,
        notificationType: outbox.notificationType,
        recipientUserId,
        notificationIdentityId: identity.id,
        created,
      },
    }),
  ]);

  return toProofEnqueueResult(outbox, created);
}
