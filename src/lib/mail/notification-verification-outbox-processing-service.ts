import { and, eq, lte, or, sql } from "drizzle-orm";
import type { MailNotificationOutbox } from "../../../drizzle/schema/mail-notification-outbox";
import { schema, type Database } from "@/lib/db";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertBatchUpdateChanged,
  buildNotificationOutboxPostStateAuditInsert,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import { CLOUDFLARE_EMAIL_NOTIFICATION_PROVIDER_ID } from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import { findNotificationIdentityById } from "@/lib/mail/notification-identity-service";
import {
  computeNotificationRetryAfter,
  NOTIFICATION_ERROR_MESSAGE_MAX_LENGTH,
  NOTIFICATION_FAILURE_CODES,
  NOTIFICATION_MAX_ATTEMPTS,
} from "@/lib/mail/notification-outbox-constants";
import {
  claimNotificationOutboxForProcessing,
  findNotificationOutboxById,
  type ProcessNotificationOutboxResult,
} from "@/lib/mail/notification-outbox-processing-service";
import { getNotificationProcessingTrustNow } from "@/lib/mail/notification-processing-lease";
import { isMailNotificationIdentityVerificationOutbox } from "@/lib/mail/notification-source-entity-policy";
import type { NotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import type { MailOperationalActor } from "@/lib/mail/system-mail-actor";
import {
  generateVerificationChallenge,
  verificationExpiresAt,
} from "@/lib/mail/verification-token";

export const VERIFICATION_OUTBOX_FAILURE_CODES = {
  superseded: "verification_send_superseded",
  identityNotPending: "verification_identity_not_pending",
  identityInvalid: "verification_identity_invalid",
  transportFailed: "verification_transport_failed",
} as const;

function sanitizeErrorMessage(message: string | undefined): string | null {
  if (!message) {
    return null;
  }
  const trimmed = message.trim().slice(0, NOTIFICATION_ERROR_MESSAGE_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

async function getNextAttemptNumber(
  db: Database,
  outboxId: string,
): Promise<number> {
  const [row] = await db
    .select({
      maxAttempt: sql<number>`coalesce(max(${schema.mailNotificationAttempts.attemptNumber}), 0)`,
    })
    .from(schema.mailNotificationAttempts)
    .where(eq(schema.mailNotificationAttempts.notificationOutboxId, outboxId));
  return (row?.maxAttempt ?? 0) + 1;
}

async function terminalVerificationSkip(
  db: Database,
  actor: MailOperationalActor,
  outbox: MailNotificationOutbox,
  failureCode: string,
): Promise<ProcessNotificationOutboxResult> {
  const now = getNotificationProcessingTrustNow();
  const expectedVersion = outbox.processingVersion;
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationOutbox)
      .set({
        status: "failed_permanent",
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
        nextAttemptAt: null,
        failureCode,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailNotificationOutbox.id, outbox.id),
          eq(schema.mailNotificationOutbox.status, "processing"),
          eq(
            schema.mailNotificationOutbox.processingVersion,
            expectedVersion,
          ),
        ),
      ),
    buildNotificationOutboxPostStateAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.notificationIdentityVerificationDeliveryFailed,
      outboxId: outbox.id,
      expectedProcessingVersion: expectedVersion,
      expectedStatus: "failed_permanent",
      metadata: {
        outboxId: outbox.id,
        failureCode,
        skippedBeforeTransport: true,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Verification skip CAS failed");

  return {
    outcome: "skipped",
    outboxId: outbox.id,
    failureCode,
  };
}

async function finalizeVerificationSent(
  db: Database,
  actor: MailOperationalActor,
  outbox: MailNotificationOutbox,
  attemptId: string,
  providerRequestId: string | undefined,
): Promise<ProcessNotificationOutboxResult> {
  const now = getNotificationProcessingTrustNow();
  const expectedVersion = outbox.processingVersion;
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationAttempts)
      .set({
        state: "accepted",
        completedAt: now,
        providerRequestId: providerRequestId ?? null,
      })
      .where(
        and(
          eq(schema.mailNotificationAttempts.id, attemptId),
          eq(schema.mailNotificationAttempts.state, "started"),
          eq(
            schema.mailNotificationAttempts.processingVersion,
            expectedVersion,
          ),
        ),
      ),
    db
      .update(schema.mailNotificationOutbox)
      .set({
        status: "sent",
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
        nextAttemptAt: null,
        failureCode: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailNotificationOutbox.id, outbox.id),
          eq(schema.mailNotificationOutbox.status, "processing"),
          eq(
            schema.mailNotificationOutbox.processingVersion,
            expectedVersion,
          ),
        ),
      ),
    buildNotificationOutboxPostStateAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.notificationIdentityVerificationDeliveryAccepted,
      outboxId: outbox.id,
      expectedProcessingVersion: expectedVersion,
      expectedStatus: "sent",
      metadata: {
        outboxId: outbox.id,
        notificationIdentityId: outbox.notificationIdentityId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Verification attempt accept CAS failed");
  assertBatchUpdateChanged(results, 1, "Verification outbox sent CAS failed");

  return {
    outcome: "sent",
    outboxId: outbox.id,
    attemptId,
  };
}

async function finalizeVerificationRetryableFailure(
  db: Database,
  actor: MailOperationalActor,
  outbox: MailNotificationOutbox,
  attemptId: string,
  attemptNumber: number,
  errorCode: string,
  errorMessage: string | undefined,
): Promise<ProcessNotificationOutboxResult> {
  const now = getNotificationProcessingTrustNow();
  const expectedVersion = outbox.processingVersion;

  if (attemptNumber >= NOTIFICATION_MAX_ATTEMPTS) {
    return terminalVerificationSkip(
      db,
      actor,
      outbox,
      NOTIFICATION_FAILURE_CODES.retryExhausted,
    );
  }

  const nextAttemptAt = computeNotificationRetryAfter(
    attemptNumber,
    Date.parse(now),
  );
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationAttempts)
      .set({
        state: "temporary_failure",
        completedAt: now,
        errorCode,
        errorMessage: sanitizeErrorMessage(errorMessage),
      })
      .where(
        and(
          eq(schema.mailNotificationAttempts.id, attemptId),
          eq(schema.mailNotificationAttempts.state, "started"),
          eq(
            schema.mailNotificationAttempts.processingVersion,
            expectedVersion,
          ),
        ),
      ),
    db
      .update(schema.mailNotificationOutbox)
      .set({
        status: "failed_retryable",
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
        nextAttemptAt,
        failureCode: errorCode,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailNotificationOutbox.id, outbox.id),
          eq(schema.mailNotificationOutbox.status, "processing"),
          eq(
            schema.mailNotificationOutbox.processingVersion,
            expectedVersion,
          ),
        ),
      ),
    buildNotificationOutboxPostStateAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.notificationIdentityVerificationDeliveryFailed,
      outboxId: outbox.id,
      expectedProcessingVersion: expectedVersion,
      expectedStatus: "failed_retryable",
      metadata: {
        outboxId: outbox.id,
        failureCode: errorCode,
        attemptNumber,
        nextAttemptAt,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Verification retry attempt CAS failed");
  assertBatchUpdateChanged(results, 1, "Verification retry outbox CAS failed");

  return {
    outcome: "failed_retryable",
    outboxId: outbox.id,
    attemptId,
  };
}

/**
 * Worker-side verification delivery — MODEL B token generation at dispatch.
 * Raw challenge exists only in memory during transport.
 */
export async function processClaimedVerificationOutboxDelivery(
  db: Database,
  actor: MailOperationalActor,
  input: {
    outboxId: string;
    sink: NotificationVerificationChallengeSink;
  },
): Promise<ProcessNotificationOutboxResult> {
  const outbox = await findNotificationOutboxById(db, input.outboxId);
  if (!outbox) {
    throw MailServiceError.notFound("Notification outbox not found");
  }
  if (outbox.status !== "processing") {
    throw MailServiceError.conflict("Notification outbox is not processing");
  }
  if (!isMailNotificationIdentityVerificationOutbox(outbox)) {
    throw MailServiceError.validation(
      "Outbox row is not a verification delivery job",
    );
  }

  const identity = await findNotificationIdentityById(
    db,
    outbox.notificationIdentityId,
  );
  if (
    !identity ||
    identity.userId !== outbox.recipientUserId ||
    identity.revokedAt
  ) {
    return terminalVerificationSkip(
      db,
      actor,
      outbox,
      VERIFICATION_OUTBOX_FAILURE_CODES.identityInvalid,
    );
  }
  if (identity.verificationStatus !== "pending") {
    return terminalVerificationSkip(
      db,
      actor,
      outbox,
      VERIFICATION_OUTBOX_FAILURE_CODES.identityNotPending,
    );
  }
  if (
    identity.verificationRequestedAt &&
    identity.verificationRequestedAt > outbox.enqueuedAt
  ) {
    return terminalVerificationSkip(
      db,
      actor,
      outbox,
      VERIFICATION_OUTBOX_FAILURE_CODES.superseded,
    );
  }

  const attemptNumber = await getNextAttemptNumber(db, outbox.id);
  const attemptId = crypto.randomUUID();
  const now = getNotificationProcessingTrustNow();
  const expectedVersion = outbox.processingVersion;

  await db.insert(schema.mailNotificationAttempts).values({
    id: attemptId,
    notificationOutboxId: outbox.id,
    attemptNumber,
    processingVersion: expectedVersion,
    state: "started",
    provider: CLOUDFLARE_EMAIL_NOTIFICATION_PROVIDER_ID,
    startedAt: now,
  });

  const { token, tokenHash } = generateVerificationChallenge();
  const expiresAt = verificationExpiresAt();

  const hashResults = await runMailBatch(db, [
    db
      .update(schema.mailNotificationIdentities)
      .set({
        verificationTokenHash: tokenHash,
        verificationExpiresAt: expiresAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailNotificationIdentities.id, identity.id),
          eq(schema.mailNotificationIdentities.userId, identity.userId),
          eq(schema.mailNotificationIdentities.verificationStatus, "pending"),
          sql`${schema.mailNotificationIdentities.revokedAt} IS NULL`,
          or(
            sql`${schema.mailNotificationIdentities.verificationRequestedAt} IS NULL`,
            lte(
              schema.mailNotificationIdentities.verificationRequestedAt,
              outbox.enqueuedAt,
            ),
          ),
        ),
      ),
  ]);

  if ((hashResults[0]?.meta?.changes ?? 0) !== 1) {
    return terminalVerificationSkip(
      db,
      actor,
      outbox,
      VERIFICATION_OUTBOX_FAILURE_CODES.superseded,
    );
  }

  let providerRequestId: string | undefined;
  try {
    await input.sink.deliverChallenge({
      notificationIdentityId: identity.id,
      targetEmail: identity.email,
      token,
      expiresAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Verification transport failed";
    return finalizeVerificationRetryableFailure(
      db,
      actor,
      outbox,
      attemptId,
      attemptNumber,
      VERIFICATION_OUTBOX_FAILURE_CODES.transportFailed,
      message,
    );
  }

  return finalizeVerificationSent(
    db,
    actor,
    outbox,
    attemptId,
    providerRequestId,
  );
}

export {
  claimNotificationOutboxForProcessing,
  type ProcessNotificationOutboxResult,
};
