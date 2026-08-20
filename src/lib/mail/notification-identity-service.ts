import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
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
import { assertMailPermissionManagement } from "@/lib/permissions/mail";
import {
  noopNotificationVerificationChallengeSink,
  type NotificationVerificationChallengeSink,
} from "@/lib/mail/notification-verification-challenge-sink";
import {
  toSafeNotificationIdentityAdminView,
  type SafeNotificationIdentityAdminView,
} from "@/lib/mail/notification-identity-serialization";
import {
  generateVerificationChallenge,
  hashVerificationToken,
  isVerificationExpired,
  verificationExpiresAt,
} from "@/lib/mail/verification-token";

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

async function requireTargetUser(db: Database, targetUserId: string) {
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
  assertMailPermissionManagement(actor);
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
  assertMailPermissionManagement(actor);
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

  const { token, tokenHash } = generateVerificationChallenge();
  const now = new Date().toISOString();
  const expiresAt = verificationExpiresAt();
  const identityId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db.insert(schema.mailNotificationIdentities).values({
        id: identityId,
        userId: input.targetUserId,
        email: normalizedEmail,
        verificationStatus: "pending",
        verificationTokenHash: tokenHash,
        verificationRequestedAt: now,
        verificationExpiresAt: expiresAt,
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

  const sink = input.challengeSink ?? noopNotificationVerificationChallengeSink;
  await sink.deliverChallenge({
    notificationIdentityId: identity.id,
    targetEmail: identity.email,
    token,
    expiresAt,
  });

  return toSafeNotificationIdentityAdminView(identity);
}

export async function verifyNotificationIdentity(
  db: Database,
  actor: MailActorContext,
  input: { identityId: string; token: string },
): Promise<SafeNotificationIdentityAdminView> {
  assertMailPermissionManagement(actor);

  const pending = await findNotificationIdentityById(db, input.identityId);
  if (!pending) {
    throw MailServiceError.notFound("Notification identity not found");
  }
  if (pending.verificationStatus !== "pending" || pending.revokedAt) {
    throw MailServiceError.conflict(
      "Notification identity is not pending verification",
    );
  }
  if (
    !pending.verificationTokenHash ||
    pending.verificationTokenHash !== hashVerificationToken(input.token)
  ) {
    throw MailServiceError.validation("Invalid verification token");
  }
  if (isVerificationExpired(pending.verificationExpiresAt)) {
    throw MailServiceError.conflict("Verification token has expired");
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

function isUniqueConstraintError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /UNIQUE constraint failed/i.test(message);
}
