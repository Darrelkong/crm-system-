import { and, desc, eq, lte, or, sql } from "drizzle-orm";
import type { MailNotificationAttempt } from "../../../drizzle/schema/mail-notification-attempts";
import type { MailNotificationOutbox } from "../../../drizzle/schema/mail-notification-outbox";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertBatchUpdateChanged,
  buildNotificationOutboxAuditInsert,
  buildNotificationOutboxPostStateAuditInsert,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import { findNotificationIdentityById } from "@/lib/mail/notification-identity-service";
import {
  computeNotificationRetryAfter,
  NOTIFICATION_ATTEMPT_ERROR_CODES,
  NOTIFICATION_ERROR_MESSAGE_MAX_LENGTH,
  NOTIFICATION_FAILURE_CODES,
  NOTIFICATION_MAX_ATTEMPTS,
} from "@/lib/mail/notification-outbox-constants";
import {
  computeNotificationProcessingLease,
  getNotificationProcessingTrustNow,
  isNotificationProcessingLeaseExpired,
} from "@/lib/mail/notification-processing-lease";
import { renderNotificationPayload } from "@/lib/mail/notification-privacy-renderer";
import type {
  NotificationTransportAdapter,
  NotificationTransportResult,
} from "@/lib/mail/notification-transport-adapter";
import { assertMailDeliveryHealth } from "@/lib/permissions/mail";

export type ClaimNotificationOutboxResult =
  | { claimed: true; outbox: MailNotificationOutbox }
  | { claimed: false; reason: "not_eligible" | "stale_version" };

export type ProcessNotificationOutboxResult =
  | { outcome: "sent"; outboxId: string; attemptId: string }
  | { outcome: "failed_retryable"; outboxId: string; attemptId: string }
  | { outcome: "failed_permanent"; outboxId: string; failureCode: string }
  | { outcome: "skipped"; outboxId: string; failureCode: string };

export type RecoverNotificationProcessingResult =
  | {
      outcome: "RECOVERED_TO_PENDING";
      outboxId: string;
      previousProcessingVersion: number;
      newProcessingVersion: number;
    }
  | {
      outcome: "AMBIGUOUS_TERMINALIZED";
      outboxId: string;
      attemptId: string;
      processingVersion: number;
    }
  | { outcome: "RECOVERY_NOT_READY"; outboxId: string; message: string };

function sanitizeErrorMessage(message: string | undefined): string | null {
  if (!message) {
    return null;
  }
  const trimmed = message.trim().slice(0, NOTIFICATION_ERROR_MESSAGE_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

export async function findNotificationOutboxById(
  db: Database,
  outboxId: string,
): Promise<MailNotificationOutbox | null> {
  const [row] = await db
    .select()
    .from(schema.mailNotificationOutbox)
    .where(eq(schema.mailNotificationOutbox.id, outboxId))
    .limit(1);
  return row ?? null;
}

async function findStartedAttemptForVersion(
  db: Database,
  outboxId: string,
  processingVersion: number,
): Promise<MailNotificationAttempt | null> {
  const [row] = await db
    .select()
    .from(schema.mailNotificationAttempts)
    .where(
      and(
        eq(schema.mailNotificationAttempts.notificationOutboxId, outboxId),
        eq(schema.mailNotificationAttempts.processingVersion, processingVersion),
        eq(schema.mailNotificationAttempts.state, "started"),
      ),
    )
    .limit(1);
  return row ?? null;
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

async function isMailAccessEnabled(
  db: Database,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ isEnabled: schema.mailUserAccess.isEnabled })
    .from(schema.mailUserAccess)
    .where(eq(schema.mailUserAccess.userId, userId))
    .limit(1);
  return row?.isEnabled === 1;
}

type DispatchGateFailure = {
  failureCode: string;
};

async function evaluateDispatchGates(
  db: Database,
  outbox: MailNotificationOutbox,
): Promise<DispatchGateFailure | null> {
  const identity = await findNotificationIdentityById(
    db,
    outbox.notificationIdentityId,
  );
  if (
    !identity ||
    identity.userId !== outbox.recipientUserId ||
    identity.verificationStatus !== "verified" ||
    identity.revokedAt
  ) {
    return {
      failureCode: NOTIFICATION_FAILURE_CODES.notificationIdentityInvalid,
    };
  }
  if (identity.deliveryHealth === "bounced") {
    return {
      failureCode: NOTIFICATION_FAILURE_CODES.notificationIdentityBounced,
    };
  }
  const accessEnabled = await isMailAccessEnabled(db, outbox.recipientUserId);
  if (!accessEnabled) {
    return { failureCode: NOTIFICATION_FAILURE_CODES.mailAccessDisabled };
  }
  return null;
}

async function terminalSkipWithoutTransport(
  db: Database,
  actor: MailActorContext,
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
      action: MAIL_AUDIT_ACTIONS.notificationPermanentlyFailed,
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

  assertBatchUpdateChanged(results, 0, "Notification gate skip CAS failed");

  return {
    outcome: "failed_permanent",
    outboxId: outbox.id,
    failureCode,
  };
}

export async function claimNotificationOutboxForProcessing(
  db: Database,
  input: { outboxId: string; expectedProcessingVersion?: number },
): Promise<ClaimNotificationOutboxResult> {
  const outbox = await findNotificationOutboxById(db, input.outboxId);
  if (!outbox) {
    throw MailServiceError.notFound("Notification outbox not found");
  }

  if (
    input.expectedProcessingVersion !== undefined &&
    outbox.processingVersion !== input.expectedProcessingVersion
  ) {
    return { claimed: false, reason: "stale_version" };
  }

  const trustNow = getNotificationProcessingTrustNow();
  const eligible =
    outbox.status === "pending" ||
    (outbox.status === "failed_retryable" &&
      outbox.nextAttemptAt !== null &&
      outbox.nextAttemptAt <= trustNow);

  if (!eligible) {
    return { claimed: false, reason: "not_eligible" };
  }

  const lease = computeNotificationProcessingLease(trustNow);
  const expectedVersion = outbox.processingVersion;
  const nextVersion = expectedVersion + 1;

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationOutbox)
      .set({
        status: "processing",
        processingVersion: nextVersion,
        processingStartedAt: lease.processingStartedAt,
        processingLeaseExpiresAt: lease.processingLeaseExpiresAt,
        nextAttemptAt: null,
        failureCode: null,
        updatedAt: trustNow,
      })
      .where(
        and(
          eq(schema.mailNotificationOutbox.id, outbox.id),
          eq(schema.mailNotificationOutbox.processingVersion, expectedVersion),
          or(
            eq(schema.mailNotificationOutbox.status, "pending"),
            and(
              eq(schema.mailNotificationOutbox.status, "failed_retryable"),
              lte(schema.mailNotificationOutbox.nextAttemptAt, trustNow),
            ),
          ),
        ),
      ),
  ]);

  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    return { claimed: false, reason: "stale_version" };
  }

  const claimed = await findNotificationOutboxById(db, outbox.id);
  if (!claimed || claimed.status !== "processing") {
    throw MailServiceError.integrityConflict("Notification claim failed");
  }
  return { claimed: true, outbox: claimed };
}

async function createStartedAttempt(
  db: Database,
  outbox: MailNotificationOutbox,
  provider: string,
): Promise<MailNotificationAttempt> {
  const attemptNumber = await getNextAttemptNumber(db, outbox.id);
  const attemptId = crypto.randomUUID();
  const now = getNotificationProcessingTrustNow();

  await db.insert(schema.mailNotificationAttempts).values({
    id: attemptId,
    notificationOutboxId: outbox.id,
    attemptNumber,
    processingVersion: outbox.processingVersion,
    state: "started",
    provider,
    startedAt: now,
  });

  const [attempt] = await db
    .select()
    .from(schema.mailNotificationAttempts)
    .where(eq(schema.mailNotificationAttempts.id, attemptId))
    .limit(1);
  if (!attempt) {
    throw MailServiceError.integrityConflict("Notification attempt insert failed");
  }
  return attempt;
}

async function finalizeAttemptAccepted(
  db: Database,
  actor: MailActorContext,
  outbox: MailNotificationOutbox,
  attempt: MailNotificationAttempt,
  providerRequestId: string | undefined,
): Promise<void> {
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
          eq(schema.mailNotificationAttempts.id, attempt.id),
          eq(schema.mailNotificationAttempts.state, "started"),
          eq(
            schema.mailNotificationAttempts.processingVersion,
            expectedVersion,
          ),
          eq(schema.mailNotificationAttempts.notificationOutboxId, outbox.id),
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
      action: MAIL_AUDIT_ACTIONS.notificationSent,
      outboxId: outbox.id,
      expectedProcessingVersion: expectedVersion,
      expectedStatus: "sent",
      metadata: {
        outboxId: outbox.id,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        notificationType: outbox.notificationType,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Notification attempt accept CAS failed");
  assertBatchUpdateChanged(results, 1, "Notification outbox sent CAS failed");
}

async function finalizeAttemptTemporaryFailure(
  db: Database,
  actor: MailActorContext,
  outbox: MailNotificationOutbox,
  attempt: MailNotificationAttempt,
  errorCode: string,
  errorMessage: string | undefined,
): Promise<ProcessNotificationOutboxResult> {
  const now = getNotificationProcessingTrustNow();
  const expectedVersion = outbox.processingVersion;
  const auditId = crypto.randomUUID();

  if (attempt.attemptNumber >= NOTIFICATION_MAX_ATTEMPTS) {
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
            eq(schema.mailNotificationAttempts.id, attempt.id),
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
          status: "failed_permanent",
          processingStartedAt: null,
          processingLeaseExpiresAt: null,
          nextAttemptAt: null,
          failureCode: NOTIFICATION_FAILURE_CODES.retryExhausted,
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
        action: MAIL_AUDIT_ACTIONS.notificationPermanentlyFailed,
        outboxId: outbox.id,
        expectedProcessingVersion: expectedVersion,
        expectedStatus: "failed_permanent",
        metadata: {
          outboxId: outbox.id,
          failureCode: NOTIFICATION_FAILURE_CODES.retryExhausted,
          attemptNumber: attempt.attemptNumber,
        },
      }),
    ]);

    assertBatchUpdateChanged(results, 0, "Retry exhausted attempt CAS failed");
    assertBatchUpdateChanged(results, 1, "Retry exhausted outbox CAS failed");

    return {
      outcome: "failed_permanent",
      outboxId: outbox.id,
      failureCode: NOTIFICATION_FAILURE_CODES.retryExhausted,
    };
  }

  const nextAttemptAt = computeNotificationRetryAfter(
    attempt.attemptNumber,
    Date.parse(now),
  );

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
          eq(schema.mailNotificationAttempts.id, attempt.id),
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
        failureCode: NOTIFICATION_FAILURE_CODES.transportTemporaryFailure,
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
  ]);

  assertBatchUpdateChanged(results, 0, "Temporary failure attempt CAS failed");
  assertBatchUpdateChanged(results, 1, "Temporary failure outbox CAS failed");

  return {
    outcome: "failed_retryable",
    outboxId: outbox.id,
    attemptId: attempt.id,
  };
}

async function finalizeAttemptPermanentFailure(
  db: Database,
  actor: MailActorContext,
  outbox: MailNotificationOutbox,
  attempt: MailNotificationAttempt,
  errorCode: string,
  errorMessage: string | undefined,
): Promise<ProcessNotificationOutboxResult> {
  const now = getNotificationProcessingTrustNow();
  const expectedVersion = outbox.processingVersion;
  const failureCode = NOTIFICATION_FAILURE_CODES.transportPermanentFailure;
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationAttempts)
      .set({
        state: "permanent_failure",
        completedAt: now,
        errorCode,
        errorMessage: sanitizeErrorMessage(errorMessage),
      })
      .where(
        and(
          eq(schema.mailNotificationAttempts.id, attempt.id),
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
      action: MAIL_AUDIT_ACTIONS.notificationPermanentlyFailed,
      outboxId: outbox.id,
      expectedProcessingVersion: expectedVersion,
      expectedStatus: "failed_permanent",
      metadata: {
        outboxId: outbox.id,
        failureCode,
        attemptNumber: attempt.attemptNumber,
        transportErrorCode: errorCode,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Permanent failure attempt CAS failed");
  assertBatchUpdateChanged(results, 1, "Permanent failure outbox CAS failed");

  return {
    outcome: "failed_permanent",
    outboxId: outbox.id,
    failureCode,
  };
}

function mapTransportResult(
  result: NotificationTransportResult,
): NotificationTransportResult {
  return result;
}

/**
 * Process a claimed notification outbox row through dispatch gates, started
 * attempt persistence, fake/real adapter call, and terminal transitions.
 */
export async function processClaimedNotificationOutbox(
  db: Database,
  actor: MailActorContext,
  input: {
    outboxId: string;
    adapter: NotificationTransportAdapter;
  },
): Promise<ProcessNotificationOutboxResult> {
  const outbox = await findNotificationOutboxById(db, input.outboxId);
  if (!outbox) {
    throw MailServiceError.notFound("Notification outbox not found");
  }
  if (outbox.status !== "processing") {
    throw MailServiceError.conflict("Notification outbox is not processing");
  }

  const gateFailure = await evaluateDispatchGates(db, outbox);
  if (gateFailure) {
    return terminalSkipWithoutTransport(
      db,
      actor,
      outbox,
      gateFailure.failureCode,
    );
  }

  const identity = await findNotificationIdentityById(
    db,
    outbox.notificationIdentityId,
  );
  if (!identity) {
    return terminalSkipWithoutTransport(
      db,
      actor,
      outbox,
      NOTIFICATION_FAILURE_CODES.notificationIdentityInvalid,
    );
  }

  const attempt = await createStartedAttempt(db, outbox, input.adapter.providerId);
  const payload = renderNotificationPayload(outbox.notificationType);

  let transportResult: NotificationTransportResult;
  try {
    transportResult = mapTransportResult(
      await input.adapter.send({
        targetEmail: identity.email,
        payload,
        outboxId: outbox.id,
        attemptNumber: attempt.attemptNumber,
      }),
    );
  } catch {
    transportResult = { outcome: "ambiguous" };
  }

  const freshOutbox = await findNotificationOutboxById(db, outbox.id);
  if (
    !freshOutbox ||
    freshOutbox.status !== "processing" ||
    freshOutbox.processingVersion !== outbox.processingVersion
  ) {
    throw MailServiceError.staleVersion(
      "Notification outbox changed during transport",
    );
  }

  if (transportResult.outcome === "accepted") {
    await finalizeAttemptAccepted(
      db,
      actor,
      freshOutbox,
      attempt,
      transportResult.providerRequestId,
    );
    return {
      outcome: "sent",
      outboxId: outbox.id,
      attemptId: attempt.id,
    };
  }

  if (transportResult.outcome === "temporary_failure") {
    return finalizeAttemptTemporaryFailure(
      db,
      actor,
      freshOutbox,
      attempt,
      transportResult.errorCode,
      transportResult.errorMessage,
    );
  }

  if (transportResult.outcome === "permanent_failure") {
    return finalizeAttemptPermanentFailure(
      db,
      actor,
      freshOutbox,
      attempt,
      transportResult.errorCode,
      transportResult.errorMessage,
    );
  }

  return finalizeAmbiguousStartedAttempt(db, actor, freshOutbox, attempt);
}

async function finalizeAmbiguousStartedAttempt(
  db: Database,
  actor: MailActorContext,
  outbox: MailNotificationOutbox,
  attempt: MailNotificationAttempt,
): Promise<ProcessNotificationOutboxResult> {
  const now = getNotificationProcessingTrustNow();
  const expectedVersion = outbox.processingVersion;
  const failureCode = NOTIFICATION_FAILURE_CODES.transportOutcomeUnknown;
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationAttempts)
      .set({
        state: "outcome_unknown",
        completedAt: now,
        errorCode: NOTIFICATION_ATTEMPT_ERROR_CODES.transportOutcomeUnknown,
        errorMessage: null,
      })
      .where(
        and(
          eq(schema.mailNotificationAttempts.id, attempt.id),
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
      action: MAIL_AUDIT_ACTIONS.notificationPermanentlyFailed,
      outboxId: outbox.id,
      expectedProcessingVersion: expectedVersion,
      expectedStatus: "failed_permanent",
      metadata: {
        outboxId: outbox.id,
        failureCode,
        attemptId: attempt.id,
        ambiguousTransport: true,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Ambiguous attempt CAS failed");
  assertBatchUpdateChanged(results, 1, "Ambiguous outbox CAS failed");

  return {
    outcome: "failed_permanent",
    outboxId: outbox.id,
    failureCode,
  };
}

export async function recoverExpiredNotificationProcessing(
  db: Database,
  actor: MailActorContext,
  outboxId: string,
): Promise<RecoverNotificationProcessingResult> {
  assertMailDeliveryHealth(actor);

  const outbox = await findNotificationOutboxById(db, outboxId);
  if (!outbox) {
    throw MailServiceError.notFound("Notification outbox not found");
  }
  if (outbox.status !== "processing") {
    return {
      outcome: "RECOVERY_NOT_READY",
      outboxId,
      message: "Outbox is not processing",
    };
  }
  if (!isNotificationProcessingLeaseExpired(outbox)) {
    return {
      outcome: "RECOVERY_NOT_READY",
      outboxId,
      message: "Processing lease is still active",
    };
  }

  const startedAttempt = await findStartedAttemptForVersion(
    db,
    outbox.id,
    outbox.processingVersion,
  );

  if (startedAttempt) {
    await finalizeAmbiguousStartedAttempt(db, actor, outbox, startedAttempt);
    return {
      outcome: "AMBIGUOUS_TERMINALIZED",
      outboxId,
      attemptId: startedAttempt.id,
      processingVersion: outbox.processingVersion,
    };
  }

  const trustNow = getNotificationProcessingTrustNow();
  const expectedVersion = outbox.processingVersion;
  const nextVersion = expectedVersion + 1;
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationOutbox)
      .set({
        status: "pending",
        processingVersion: nextVersion,
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
        updatedAt: trustNow,
      })
      .where(
        and(
          eq(schema.mailNotificationOutbox.id, outbox.id),
          eq(schema.mailNotificationOutbox.status, "processing"),
          eq(
            schema.mailNotificationOutbox.processingVersion,
            expectedVersion,
          ),
          lte(schema.mailNotificationOutbox.processingLeaseExpiresAt, trustNow),
        ),
      ),
    buildNotificationOutboxAuditInsert(db, actor, {
      auditId,
      now: trustNow,
      action: MAIL_AUDIT_ACTIONS.notificationProcessingRecovered,
      outboxId: outbox.id,
      metadata: {
        outboxId: outbox.id,
        previousProcessingVersion: expectedVersion,
        newProcessingVersion: nextVersion,
        recoveryKind: "abandoned_claim",
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Notification safe recovery CAS failed");

  return {
    outcome: "RECOVERED_TO_PENDING",
    outboxId,
    previousProcessingVersion: expectedVersion,
    newProcessingVersion: nextVersion,
  };
}

export async function claimAndProcessNotificationOutbox(
  db: Database,
  actor: MailActorContext,
  input: {
    outboxId: string;
    adapter: NotificationTransportAdapter;
  },
): Promise<
  | ({ phase: "claim_failed" } & ClaimNotificationOutboxResult)
  | ({ phase: "processed" } & ProcessNotificationOutboxResult)
> {
  const claim = await claimNotificationOutboxForProcessing(db, {
    outboxId: input.outboxId,
  });
  if (!claim.claimed) {
    return { phase: "claim_failed", ...claim };
  }
  const processed = await processClaimedNotificationOutbox(db, actor, {
    outboxId: input.outboxId,
    adapter: input.adapter,
  });
  return { phase: "processed", ...processed };
}

export type NotificationOutboxHealthListItem = {
  id: string;
  notificationType: MailNotificationOutbox["notificationType"];
  status: MailNotificationOutbox["status"];
  recipientUserId: string;
  processingVersion: number;
  enqueuedAt: string;
  nextAttemptAt: string | null;
  failureCode: string | null;
};

export async function listNotificationOutboxForHealth(
  db: Database,
  actor: MailActorContext,
  input?: { limit?: number },
): Promise<NotificationOutboxHealthListItem[]> {
  assertMailDeliveryHealth(actor);
  const limit = input?.limit ?? 100;
  const rows = await db
    .select({
      id: schema.mailNotificationOutbox.id,
      notificationType: schema.mailNotificationOutbox.notificationType,
      status: schema.mailNotificationOutbox.status,
      recipientUserId: schema.mailNotificationOutbox.recipientUserId,
      processingVersion: schema.mailNotificationOutbox.processingVersion,
      enqueuedAt: schema.mailNotificationOutbox.enqueuedAt,
      nextAttemptAt: schema.mailNotificationOutbox.nextAttemptAt,
      failureCode: schema.mailNotificationOutbox.failureCode,
    })
    .from(schema.mailNotificationOutbox)
    .orderBy(desc(schema.mailNotificationOutbox.enqueuedAt))
    .limit(limit);
  return rows;
}

/** Stale-worker finalize guard — exposed for tests. */
export async function finalizeAttemptAcceptedForTest(
  db: Database,
  actor: MailActorContext,
  outbox: MailNotificationOutbox,
  attempt: MailNotificationAttempt,
  providerRequestId?: string,
): Promise<void> {
  return finalizeAttemptAccepted(db, actor, outbox, attempt, providerRequestId);
}
