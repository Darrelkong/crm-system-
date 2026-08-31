import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { MailNotificationDeliveryHealth } from "../../../drizzle/schema/mail-notification-identities";
import type { MailNotificationIdentity } from "../../../drizzle/schema/mail-notification-identities";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertBatchUpdateChanged,
  isMailPostStateGuardError,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";
import {
  assertMailNotificationProofManagement,
  assertMailPermissionManagement,
  assertNotificationIdentityTargetAccess,
  isCrmRootAdmin,
} from "@/lib/permissions/mail";
import {
  type NotificationVerificationChallengeSink,
} from "@/lib/mail/notification-verification-challenge-sink";
import {
  NotificationVerificationChallengeDeliveryError,
  isVerificationChallengeDeliveryFailure,
  resolveNotificationVerificationChallengeSink,
  resolveVerificationChallengeDeliveryStatus,
} from "@/lib/mail/notification-verification-challenge-delivery";
import type { MailNotificationVerificationTransportDeliveryStatus } from "@/lib/mail/notification-verification-transport";
import { isMailNotificationVerificationTransportEnabled } from "@/lib/mail/notification-verification-transport";
import { enqueueNotificationIdentityVerificationDelivery } from "@/lib/mail/notification-verification-enqueue-service";
import {
  toSafeNotificationIdentityAdminView,
  type SafeNotificationIdentityAdminView,
} from "@/lib/mail/notification-identity-serialization";
import {
  generateVerificationChallenge,
  isVerificationExpired,
  verifyVerificationTokenHash,
  verificationExpiresAt,
} from "@/lib/mail/verification-token";
import {
  NOTIFICATION_VERIFICATION_MAX_ATTEMPTS,
  assertVerificationResendAllowed,
  isValidVerificationCodeFormat,
  isVerificationChallengeLocked,
  normalizeVerificationCodeInput,
  remainingVerificationAttempts,
} from "@/lib/mail/notification-verification-challenge-policy";

export type { SafeNotificationIdentityAdminView };
export { toSafeNotificationIdentityAdminView };

function buildNotificationIdentityAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${input.auditId} AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_notification_identity"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

export function buildVerifiedSwapPostStateAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    action: string;
    newIdentityId: string;
    targetUserId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_notification_identities new_identity
          WHERE new_identity.id = ${input.newIdentityId}
            AND new_identity.user_id = ${input.targetUserId}
            AND new_identity.verification_status = 'verified'
            AND new_identity.revoked_at IS NULL
            AND new_identity.verified_at IS NOT NULL
          LIMIT 1
        ) AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_notification_identity"} AS entity_type,
        ${input.newIdentityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}

export async function requireTargetUser(db: Database, targetUserId: string) {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (!user) {
    throw MailServiceError.notFound("Target user not found");
  }
}

export async function findNotificationIdentityById(
  db: Database,
  identityId: string,
): Promise<MailNotificationIdentity | null> {
  const [row] = await db
    .select()
    .from(schema.mailNotificationIdentities)
    .where(eq(schema.mailNotificationIdentities.id, identityId))
    .limit(1);
  return row ?? null;
}

export async function findActiveVerifiedNotificationIdentity(
  db: Database,
  targetUserId: string,
): Promise<MailNotificationIdentity | null> {
  const [row] = await db
    .select()
    .from(schema.mailNotificationIdentities)
    .where(
      and(
        eq(schema.mailNotificationIdentities.userId, targetUserId),
        eq(schema.mailNotificationIdentities.verificationStatus, "verified"),
        isNull(schema.mailNotificationIdentities.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findActivePendingNotificationIdentity(
  db: Database,
  targetUserId: string,
): Promise<MailNotificationIdentity | null> {
  const [row] = await db
    .select()
    .from(schema.mailNotificationIdentities)
    .where(
      and(
        eq(schema.mailNotificationIdentities.userId, targetUserId),
        eq(schema.mailNotificationIdentities.verificationStatus, "pending"),
        isNull(schema.mailNotificationIdentities.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listNotificationIdentitiesForAdmin(
  db: Database,
  actor: MailActorContext,
  targetUserId: string,
): Promise<SafeNotificationIdentityAdminView[]> {
  assertNotificationIdentityTargetAccess(actor, targetUserId);
  await requireTargetUser(db, targetUserId);
  const rows = await db
    .select()
    .from(schema.mailNotificationIdentities)
    .where(eq(schema.mailNotificationIdentities.userId, targetUserId));
  return rows.map(toSafeNotificationIdentityAdminView);
}

export async function createPendingNotificationIdentity(
  db: Database,
  actor: MailActorContext,
  input: {
    targetUserId: string;
    email: string;
    challengeSink?: NotificationVerificationChallengeSink;
  },
): Promise<SafeNotificationIdentityAdminView> {
  assertNotificationIdentityTargetAccess(actor, input.targetUserId);
  await requireTargetUser(db, input.targetUserId);

  let normalizedEmail: string;
  try {
    normalizedEmail = normalizeMailEmailAddress(input.email);
  } catch (error) {
    throw MailServiceError.validation(
      error instanceof Error ? error.message : "Invalid email address",
    );
  }

  const existingPending = await findActivePendingNotificationIdentity(
    db,
    input.targetUserId,
  );
  if (existingPending) {
    throw MailServiceError.conflict(
      "Target user already has a pending notification identity",
    );
  }

  const identityId = crypto.randomUUID();
  const { token, tokenHash, expiresAt } = generateVerificationChallenge(identityId);
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db.insert(schema.mailNotificationIdentities).values({
        id: identityId,
        userId: input.targetUserId,
        email: normalizedEmail,
        verificationStatus: "pending",
        verificationTokenHash: tokenHash,
        verificationRequestedAt: null,
        verificationExpiresAt: expiresAt,
        verificationAttemptCount: 0,
        deliveryHealth: "unknown",
        createdAt: now,
        updatedAt: now,
      }),
      buildNotificationIdentityAuditInsert(db, actor, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.notificationIdentityCreated,
        entityId: identityId,
        metadata: {
          targetUserId: input.targetUserId,
          notificationIdentityId: identityId,
          email: normalizedEmail,
          actorUserId: actor.userId,
        },
      }),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw MailServiceError.conflict("Notification email is already in use");
    }
    throw error;
  }

  const identity = await findNotificationIdentityById(db, identityId);
  if (!identity) {
    throw MailServiceError.integrityConflict(
      "Notification identity creation failed",
    );
  }

  if (input.challengeSink) {
    await input.challengeSink.deliverChallenge({
      notificationIdentityId: identity.id,
      targetEmail: identity.email,
      token,
      expiresAt,
    });
  }

  return toSafeNotificationIdentityAdminView(identity);
}

export function assertVerificationResendCooldown(
  pending: Pick<MailNotificationIdentity, "verificationRequestedAt">,
  nowMs: number,
): void {
  const blocked = assertVerificationResendAllowed(
    pending.verificationRequestedAt,
    nowMs,
  );
  if (blocked) {
    throw MailServiceError.conflict("Verification resend cooldown active", {
      verificationReason: "resend_cooldown",
      retryAfterSeconds: blocked.retryAfterSeconds,
    });
  }
}

async function recordFailedVerificationAttempt(
  db: Database,
  pending: MailNotificationIdentity,
  nowMs: number,
): Promise<never> {
  const now = new Date(nowMs).toISOString();
  const nextAttemptCount = pending.verificationAttemptCount + 1;

  if (nextAttemptCount >= NOTIFICATION_VERIFICATION_MAX_ATTEMPTS) {
    await runMailBatch(db, [
      db
        .update(schema.mailNotificationIdentities)
        .set({
          verificationAttemptCount: NOTIFICATION_VERIFICATION_MAX_ATTEMPTS,
          verificationTokenHash: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.mailNotificationIdentities.id, pending.id),
            eq(schema.mailNotificationIdentities.userId, pending.userId),
            eq(schema.mailNotificationIdentities.verificationStatus, "pending"),
            isNull(schema.mailNotificationIdentities.revokedAt),
            eq(
              schema.mailNotificationIdentities.verificationAttemptCount,
              pending.verificationAttemptCount,
            ),
          ),
        ),
    ]);
    throw MailServiceError.conflict("Verification code locked", {
      verificationReason: "locked",
    });
  }

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationIdentities)
      .set({
        verificationAttemptCount: nextAttemptCount,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailNotificationIdentities.id, pending.id),
          eq(schema.mailNotificationIdentities.userId, pending.userId),
          eq(schema.mailNotificationIdentities.verificationStatus, "pending"),
          isNull(schema.mailNotificationIdentities.revokedAt),
          eq(
            schema.mailNotificationIdentities.verificationAttemptCount,
            pending.verificationAttemptCount,
          ),
        ),
      ),
  ]);
  assertBatchUpdateChanged(
    results,
    0,
    "Verification attempt update conflict",
  );

  throw MailServiceError.validation("Invalid verification code", {
    verificationReason: "invalid_code",
    remainingAttempts: remainingVerificationAttempts(nextAttemptCount),
  });
}

export async function verifyNotificationIdentity(
  db: Database,
  actor: MailActorContext,
  input: { identityId: string; token: string },
): Promise<SafeNotificationIdentityAdminView> {
  const pending = await findNotificationIdentityById(db, input.identityId);
  if (!pending) {
    throw MailServiceError.notFound("Notification identity not found");
  }
  if (pending.verificationStatus !== "pending" || pending.revokedAt) {
    throw MailServiceError.conflict(
      "Notification identity is not pending verification",
    );
  }

  assertNotificationIdentityTargetAccess(actor, pending.userId);

  const nowMs = Date.now();
  if (isVerificationExpired(pending.verificationExpiresAt, nowMs)) {
    throw MailServiceError.conflict("Verification code has expired", {
      verificationReason: "expired",
    });
  }

  if (
    isVerificationChallengeLocked(pending.verificationAttemptCount) ||
    !pending.verificationTokenHash
  ) {
    throw MailServiceError.conflict("Verification code locked", {
      verificationReason: "locked",
    });
  }

  const normalizedToken = normalizeVerificationCodeInput(input.token);
  if (!isValidVerificationCodeFormat(normalizedToken)) {
    return recordFailedVerificationAttempt(db, pending, nowMs);
  }

  if (
    !verifyVerificationTokenHash(
      pending.verificationTokenHash,
      normalizedToken,
      pending.id,
    )
  ) {
    return recordFailedVerificationAttempt(db, pending, nowMs);
  }

  const currentVerified = await findActiveVerifiedNotificationIdentity(
    db,
    pending.userId,
  );
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  try {
    if (currentVerified) {
      const results = await runMailBatch(db, [
        db
          .update(schema.mailNotificationIdentities)
          .set({
            verificationStatus: "revoked",
            revokedAt: now,
            revokedBy: actor.userId,
            revokeReason: "replaced_by_verified_identity",
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.mailNotificationIdentities.id, currentVerified.id),
              eq(
                schema.mailNotificationIdentities.verificationStatus,
                "verified",
              ),
              isNull(schema.mailNotificationIdentities.revokedAt),
            ),
          ),
        db
          .update(schema.mailNotificationIdentities)
          .set({
            verificationStatus: "verified",
            verifiedAt: now,
            verificationTokenHash: null,
            verificationExpiresAt: null,
            verificationAttemptCount: 0,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.mailNotificationIdentities.id, pending.id),
              eq(
                schema.mailNotificationIdentities.verificationStatus,
                "pending",
              ),
              isNull(schema.mailNotificationIdentities.revokedAt),
            ),
          ),
        buildVerifiedSwapPostStateAuditInsert(db, actor, {
          auditId,
          now,
          action: MAIL_AUDIT_ACTIONS.notificationIdentityVerified,
          newIdentityId: pending.id,
          targetUserId: pending.userId,
          metadata: {
            targetUserId: pending.userId,
            newNotificationIdentityId: pending.id,
            oldNotificationIdentityId: currentVerified.id,
            actorUserId: actor.userId,
          },
        }),
      ]);
      assertBatchUpdateChanged(results, 0, "Verified identity revoke conflict");
      assertBatchUpdateChanged(results, 1, "Pending identity promote conflict");
    } else {
      const results = await runMailBatch(db, [
        db
          .update(schema.mailNotificationIdentities)
          .set({
            verificationStatus: "verified",
            verifiedAt: now,
            verificationTokenHash: null,
            verificationExpiresAt: null,
            verificationAttemptCount: 0,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.mailNotificationIdentities.id, pending.id),
              eq(
                schema.mailNotificationIdentities.verificationStatus,
                "pending",
              ),
              isNull(schema.mailNotificationIdentities.revokedAt),
            ),
          ),
        buildVerifiedSwapPostStateAuditInsert(db, actor, {
          auditId,
          now,
          action: MAIL_AUDIT_ACTIONS.notificationIdentityVerified,
          newIdentityId: pending.id,
          targetUserId: pending.userId,
          metadata: {
            targetUserId: pending.userId,
            newNotificationIdentityId: pending.id,
            actorUserId: actor.userId,
          },
        }),
      ]);
      assertBatchUpdateChanged(results, 0, "Pending identity promote conflict");
    }
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion("Notification identity verify conflict");
    }
    if (isUniqueConstraintError(error)) {
      throw MailServiceError.conflict("Notification identity verify conflict");
    }
    throw error;
  }

  const verified = await findNotificationIdentityById(db, pending.id);
  if (!verified || verified.verificationStatus !== "verified") {
    throw MailServiceError.integrityConflict("Notification identity verify failed");
  }
  return toSafeNotificationIdentityAdminView(verified);
}

export async function revokeNotificationIdentity(
  db: Database,
  actor: MailActorContext,
  input: { identityId: string; reason?: string },
): Promise<SafeNotificationIdentityAdminView> {
  assertMailPermissionManagement(actor);

  const identity = await findNotificationIdentityById(db, input.identityId);
  if (!identity) {
    throw MailServiceError.notFound("Notification identity not found");
  }
  if (identity.verificationStatus === "revoked" || identity.revokedAt) {
    throw MailServiceError.conflict("Notification identity is already revoked");
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationIdentities)
      .set({
        verificationStatus: "revoked",
        revokedAt: now,
        revokedBy: actor.userId,
        revokeReason: input.reason?.trim() || "admin_revoked",
        verificationTokenHash: null,
        verificationExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailNotificationIdentities.id, identity.id),
          eq(schema.mailNotificationIdentities.verificationStatus, identity.verificationStatus),
          isNull(schema.mailNotificationIdentities.revokedAt),
        ),
      ),
    buildNotificationIdentityAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.notificationIdentityRevoked,
      entityId: identity.id,
      metadata: {
        targetUserId: identity.userId,
        notificationIdentityId: identity.id,
        previousStatus: identity.verificationStatus,
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Notification identity revoke conflict");

  const revoked = await findNotificationIdentityById(db, identity.id);
  if (!revoked || revoked.verificationStatus !== "revoked") {
    throw MailServiceError.integrityConflict("Notification identity revoke failed");
  }
  return toSafeNotificationIdentityAdminView(revoked);
}

export async function updateNotificationDeliveryHealth(
  db: Database,
  actor: MailActorContext,
  input: {
    identityId: string;
    deliveryHealth: MailNotificationDeliveryHealth;
    lastDeliveryStatus?: string | null;
  },
): Promise<SafeNotificationIdentityAdminView> {
  assertMailPermissionManagement(actor);

  const identity = await findNotificationIdentityById(db, input.identityId);
  if (!identity) {
    throw MailServiceError.notFound("Notification identity not found");
  }
  if (identity.verificationStatus === "revoked" || identity.revokedAt) {
    throw MailServiceError.conflict(
      "Cannot update delivery health for revoked identity",
    );
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const problemAt =
    input.deliveryHealth === "temporary_problem" ||
    input.deliveryHealth === "bounced"
      ? now
      : null;

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationIdentities)
      .set({
        deliveryHealth: input.deliveryHealth,
        deliveryProblemAt: problemAt,
        lastDeliveryStatus: input.lastDeliveryStatus ?? identity.lastDeliveryStatus,
        lastDeliveryAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailNotificationIdentities.id, identity.id),
          isNull(schema.mailNotificationIdentities.revokedAt),
        ),
      ),
    buildNotificationIdentityAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.notificationIdentityDeliveryHealthChanged,
      entityId: identity.id,
      metadata: {
        targetUserId: identity.userId,
        notificationIdentityId: identity.id,
        oldDeliveryHealth: identity.deliveryHealth,
        newDeliveryHealth: input.deliveryHealth,
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Delivery health update conflict");

  const updated = await findNotificationIdentityById(db, identity.id);
  if (!updated || updated.deliveryHealth !== input.deliveryHealth) {
    throw MailServiceError.integrityConflict("Delivery health update failed");
  }
  return toSafeNotificationIdentityAdminView(updated);
}

/**
 * TEMPORARY H.3 PROOF TOOL — break-glass verification token issuance for
 * controlled Cloudflare Email Sending proof only.
 *
 * Long-term replacement: real verification-email delivery through a dedicated
 * verification challenge transport. Remove or permanently disable after the
 * permanent Mail Admin verification workflow ships.
 */
export const VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_MAX = 3 as const;
export const VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AdminVerificationTokenIssueResult = {
  item: {
    identityId: string;
    expiresAt: string;
  };
  verificationToken: string;
};

export type SendNotificationVerificationChallengeResult = {
  item: SafeNotificationIdentityAdminView;
  delivery: {
    status: MailNotificationVerificationTransportDeliveryStatus;
    destinationEmail: string;
  };
};

async function commitVerificationChallengeRotation(
  db: Database,
  actor: MailActorContext,
  pending: MailNotificationIdentity,
  input: {
    tokenHash: string;
    expiresAt: string;
    nowMs: number;
    auditAction: string;
    metadata: Record<string, unknown>;
    expectedVerificationRequestedAt: string | null;
    expectedVerificationTokenHash: string | null;
  },
): Promise<void> {
  const now = new Date(input.nowMs).toISOString();
  const auditId = crypto.randomUUID();
  const whereConditions = [
    eq(schema.mailNotificationIdentities.id, pending.id),
    eq(schema.mailNotificationIdentities.userId, pending.userId),
    eq(schema.mailNotificationIdentities.verificationStatus, "pending"),
    isNull(schema.mailNotificationIdentities.revokedAt),
  ];

  if (input.expectedVerificationRequestedAt === null) {
    whereConditions.push(
      isNull(schema.mailNotificationIdentities.verificationRequestedAt),
    );
  } else {
    whereConditions.push(
      eq(
        schema.mailNotificationIdentities.verificationRequestedAt,
        input.expectedVerificationRequestedAt,
      ),
    );
  }

  if (input.expectedVerificationTokenHash === null) {
    whereConditions.push(
      isNull(schema.mailNotificationIdentities.verificationTokenHash),
    );
  } else {
    whereConditions.push(
      eq(
        schema.mailNotificationIdentities.verificationTokenHash,
        input.expectedVerificationTokenHash,
      ),
    );
  }

  const results = await runMailBatch(db, [
    db
      .update(schema.mailNotificationIdentities)
      .set({
        verificationTokenHash: input.tokenHash,
        verificationRequestedAt: now,
        verificationExpiresAt: input.expiresAt,
        verificationAttemptCount: 0,
        updatedAt: now,
      })
      .where(and(...whereConditions)),
    buildNotificationIdentityAuditInsert(db, actor, {
      auditId,
      now,
      action: input.auditAction,
      entityId: pending.id,
      metadata: input.metadata,
    }),
  ]);
  assertBatchUpdateChanged(
    results,
    0,
    "Pending notification identity challenge rotation conflict",
  );
}

async function deliverAndCommitVerificationChallenge(
  db: Database,
  actor: MailActorContext,
  pending: MailNotificationIdentity,
  input: {
    nowMs: number;
    auditAction: string;
    metadata: Record<string, unknown>;
    deliver: (payload: {
      notificationIdentityId: string;
      targetEmail: string;
      token: string;
      expiresAt: string;
    }) => Promise<void>;
  },
): Promise<{ token: string; expiresAt: string }> {
  assertVerificationResendCooldown(pending, input.nowMs);
  const challenge = generateVerificationChallenge(pending.id, input.nowMs);

  try {
    await input.deliver({
      notificationIdentityId: pending.id,
      targetEmail: pending.email,
      token: challenge.token,
      expiresAt: challenge.expiresAt,
    });
  } catch (error) {
    if (error instanceof MailServiceError) {
      throw error;
    }
    throw new NotificationVerificationChallengeDeliveryError(undefined, {
      cause: error,
    });
  }

  await commitVerificationChallengeRotation(db, actor, pending, {
    tokenHash: challenge.tokenHash,
    expiresAt: challenge.expiresAt,
    nowMs: input.nowMs,
    auditAction: input.auditAction,
    metadata: input.metadata,
    expectedVerificationRequestedAt: pending.verificationRequestedAt,
    expectedVerificationTokenHash: pending.verificationTokenHash,
  });

  return { token: challenge.token, expiresAt: challenge.expiresAt };
}

async function rotatePendingVerificationChallenge(
  db: Database,
  actor: MailActorContext,
  pending: MailNotificationIdentity,
  input: {
    nowMs: number;
    auditAction: string;
    metadata: Record<string, unknown>;
  },
): Promise<{ token: string; expiresAt: string }> {
  assertVerificationResendCooldown(pending, input.nowMs);
  const challenge = generateVerificationChallenge(pending.id, input.nowMs);
  await commitVerificationChallengeRotation(db, actor, pending, {
    tokenHash: challenge.tokenHash,
    expiresAt: challenge.expiresAt,
    nowMs: input.nowMs,
    auditAction: input.auditAction,
    metadata: input.metadata,
    expectedVerificationRequestedAt: pending.verificationRequestedAt,
    expectedVerificationTokenHash: pending.verificationTokenHash,
  });
  return { token: challenge.token, expiresAt: challenge.expiresAt };
}

async function countActivePendingIdentitiesForUser(
  db: Database,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mailNotificationIdentities)
    .where(
      and(
        eq(schema.mailNotificationIdentities.userId, userId),
        eq(schema.mailNotificationIdentities.verificationStatus, "pending"),
        isNull(schema.mailNotificationIdentities.revokedAt),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Schema invariant: uq_mail_notification_identities_user_pending_active allows
 * at most one active pending identity per user_id.
 */
export async function findAuthoritativePendingIdentityForUser(
  db: Database,
  userId: string,
): Promise<MailNotificationIdentity | null> {
  const pendingCount = await countActivePendingIdentitiesForUser(db, userId);
  if (pendingCount === 0) {
    return null;
  }
  if (pendingCount > 1) {
    throw MailServiceError.integrityConflict(
      "Ambiguous pending notification identity state for user",
    );
  }
  return findActivePendingNotificationIdentity(db, userId);
}

/** CRM root administrators are exempt from the rolling 24h issue quota only. */
export function isVerificationTokenIssueRateLimitExempt(
  actor: MailActorContext,
): boolean {
  return isCrmRootAdmin(actor);
}

export async function assertVerificationTokenIssueRateLimit(
  db: Database,
  actor: MailActorContext,
  nowMs: number,
): Promise<void> {
  if (isVerificationTokenIssueRateLimitExempt(actor)) {
    return;
  }

  const windowStart = new Date(
    nowMs - VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_WINDOW_MS,
  ).toISOString();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.userId, actor.userId),
        or(
          eq(
            schema.auditLogs.action,
            MAIL_AUDIT_ACTIONS.notificationIdentityVerificationTokenIssued,
          ),
          eq(
            schema.auditLogs.action,
            MAIL_AUDIT_ACTIONS.notificationIdentityVerificationChallengeSent,
          ),
          eq(
            schema.auditLogs.action,
            MAIL_AUDIT_ACTIONS.notificationIdentityVerificationSendQueued,
          ),
        ),
        gte(schema.auditLogs.createdAt, windowStart),
      ),
    );
  if ((row?.count ?? 0) >= VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_MAX) {
    throw MailServiceError.conflict(
      "Verification token issue rate limit exceeded for the last 24 hours",
    );
  }
}

export async function sendNotificationIdentityVerificationChallenge(
  db: Database,
  actor: MailActorContext,
  targetUserId: string,
  options?: {
    nowMs?: number;
    challengeSink?: NotificationVerificationChallengeSink;
    emailBinding?: import("@/lib/mail/cloudflare-email-notification-transport-adapter").CloudflareEmailSendBinding | null;
  },
): Promise<SendNotificationVerificationChallengeResult> {
  assertNotificationIdentityTargetAccess(actor, targetUserId);
  await requireTargetUser(db, targetUserId);

  const pending = await findAuthoritativePendingIdentityForUser(
    db,
    targetUserId,
  );
  if (!pending) {
    throw MailServiceError.validation(
      "Active pending notification identity is required before verification challenge send",
    );
  }

  const transportEnabled = isMailNotificationVerificationTransportEnabled();
  const testDelivery =
    options?.challengeSink !== undefined || options?.emailBinding !== undefined;

  if (testDelivery) {
    const { sink, transportEnabled: sinkEnabled } =
      resolveNotificationVerificationChallengeSink({
        emailBinding: options?.emailBinding ?? null,
        overrideSink: options?.challengeSink,
      });

    if (!sinkEnabled && !options?.challengeSink) {
      return {
        item: toSafeNotificationIdentityAdminView(pending),
        delivery: {
          status: "transport_disabled",
          destinationEmail: pending.email,
        },
      };
    }

    const nowMs = options?.nowMs ?? Date.now();
    await assertVerificationTokenIssueRateLimit(db, actor, nowMs);

    let delivered = false;
    try {
      await deliverAndCommitVerificationChallenge(db, actor, pending, {
        nowMs,
        auditAction:
          MAIL_AUDIT_ACTIONS.notificationIdentityVerificationChallengeSent,
        metadata: {
          targetUserId,
          notificationIdentityId: pending.id,
          actorUserId: actor.userId,
          destinationEmail: pending.email,
        },
        deliver: async (payload) => {
          await sink.deliverChallenge(payload);
        },
      });
      delivered = true;
    } catch (error) {
      if (isVerificationChallengeDeliveryFailure(error)) {
        delivered = false;
      } else {
        throw error;
      }
    }

    const updated = await findNotificationIdentityById(db, pending.id);
    if (!updated) {
      throw MailServiceError.integrityConflict(
        "Notification identity challenge send failed",
      );
    }

    return {
      item: toSafeNotificationIdentityAdminView(updated),
      delivery: {
        status: resolveVerificationChallengeDeliveryStatus({
          transportEnabled: sinkEnabled,
          delivered,
        }),
        destinationEmail: pending.email,
      },
    };
  }

  if (!transportEnabled) {
    return {
      item: toSafeNotificationIdentityAdminView(pending),
      delivery: {
        status: "transport_disabled",
        destinationEmail: pending.email,
      },
    };
  }

  const queued = await enqueueNotificationIdentityVerificationDelivery(
    db,
    actor,
    targetUserId,
    { nowMs: options?.nowMs },
  );

  const updated = await findNotificationIdentityById(
    db,
    queued.notificationIdentityId,
  );
  if (!updated) {
    throw MailServiceError.integrityConflict(
      "Notification identity verification queue failed",
    );
  }

  return {
    item: toSafeNotificationIdentityAdminView(updated),
    delivery: {
      status: "queued",
      destinationEmail: queued.destinationEmail,
    },
  };
}

export async function issueSelfVerificationTokenForAdminProof(
  db: Database,
  actor: MailActorContext,
  options?: { nowMs?: number },
): Promise<AdminVerificationTokenIssueResult> {
  assertMailNotificationProofManagement(actor);

  const nowMs = options?.nowMs ?? Date.now();
  await assertVerificationTokenIssueRateLimit(db, actor, nowMs);

  const pending = await findAuthoritativePendingIdentityForUser(
    db,
    actor.userId,
  );
  if (!pending) {
    throw MailServiceError.validation(
      "Active pending notification identity is required before verification token issue",
    );
  }

  const { token, expiresAt } = await rotatePendingVerificationChallenge(
    db,
    actor,
    pending,
    {
      nowMs,
      auditAction: MAIL_AUDIT_ACTIONS.notificationIdentityVerificationTokenIssued,
      metadata: {
        targetUserId: actor.userId,
        notificationIdentityId: pending.id,
        actorUserId: actor.userId,
        selfProof: true,
        temporaryH3ProofTool: true,
      },
    },
  );

  return {
    item: {
      identityId: pending.id,
      expiresAt,
    },
    verificationToken: token,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /UNIQUE constraint failed/i.test(message);
}
