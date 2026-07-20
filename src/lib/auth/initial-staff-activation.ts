import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { DEVICE_AUDIT_ACTIONS } from "@/lib/devices/constants";
import {
  countApprovedDevicesForUser,
  getAuthorizedDeviceByUserAndHash,
  getDeviceAuthorizationLimit,
  isDeviceAuthorizationEnabled,
} from "@/lib/devices/queries";
import { canCreateInitialActivationRestrictedSession } from "@/lib/devices/initial-device-auto-approval";

export class InitialActivationConflictError extends Error {
  readonly errorCode = AUTH_ERROR_CODES.INITIAL_ACTIVATION_STATE_CHANGED;
  readonly status = 409;

  constructor(message = "啟用狀態已更新，請重新登入後再試。") {
    super(message);
    this.name = "InitialActivationConflictError";
  }
}

export type CompleteInitialStaffActivationInput = {
  userId: string;
  sessionId: string;
  deviceIdHash: string;
  passwordHash: string;
  now: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function extractChanges(result: unknown): number | null {
  if (
    result &&
    typeof result === "object" &&
    "meta" in result &&
    result.meta &&
    typeof result.meta === "object" &&
    "changes" in result.meta &&
    typeof (result.meta as { changes: unknown }).changes === "number"
  ) {
    return (result.meta as { changes: number }).changes;
  }
  return null;
}

function assertBatchChanges(
  results: unknown[],
  expected: number[],
): void {
  if (results.length < expected.length) {
    throw new InitialActivationConflictError();
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (extractChanges(results[i]) !== expected[i]) {
      throw new InitialActivationConflictError();
    }
  }
}

function buildPasswordChangedAuditSelect(input: {
  auditId: string;
  userId: string;
  passwordHash: string;
  now: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadataJson: string;
  /** Extra SQL predicates ANDed into the SELECT guard (bound fragments only). */
  extraGuardSql: ReturnType<typeof sql>;
}) {
  return sql`
    SELECT
      ${input.auditId} AS id,
      ${input.userId} AS user_id,
      ${"auth.password_changed"} AS action,
      ${"user"} AS entity_type,
      ${input.userId} AS entity_id,
      ${input.ipAddress ?? null} AS ip_address,
      ${input.userAgent ?? null} AS user_agent,
      ${input.metadataJson} AS metadata,
      ${input.now} AS created_at
    FROM users
    WHERE users.id = ${input.userId}
      AND users.password_hash = ${input.passwordHash}
      AND users.must_change_password = 0
      AND users.initial_device_auto_approval_eligible = 0
      AND users.password_changed_at = ${input.now}
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs
        WHERE action = 'auth.password_changed'
          AND entity_id = ${input.userId}
          AND created_at = ${input.now}
      )
      AND ${input.extraGuardSql}
  `;
}

/**
 * Atomically: update password, clear must-change + eligibility, approve the
 * session-bound pending device, revoke the current session, and write success
 * audits — all in one db.batch. Conditional INSERT…SELECT + affected-row checks
 * prevent loser races from writing duplicate success audits.
 */
export async function completeInitialStaffActivation(
  input: CompleteInitialStaffActivationInput,
  db?: Database,
): Promise<{ deviceRecordId: string }> {
  const database = db ?? getDb();

  const enabled = await isDeviceAuthorizationEnabled(database);
  if (!enabled) {
    throw new InitialActivationConflictError();
  }

  const userRows = await database
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, input.userId))
    .limit(1);
  const user = userRows[0];
  if (!user || user.role !== "staff" || user.isActive !== 1) {
    throw new InitialActivationConflictError();
  }

  const device = await getAuthorizedDeviceByUserAndHash(
    input.userId,
    input.deviceIdHash,
    database,
  );
  const approvedCount = await countApprovedDevicesForUser(
    input.userId,
    database,
  );
  const deviceLimit = await getDeviceAuthorizationLimit(database);

  if (
    !device ||
    !canCreateInitialActivationRestrictedSession({
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      initialDeviceAutoApprovalEligible:
        user.initialDeviceAutoApprovalEligible,
      deviceAuthorizationEnabled: true,
      deviceStatus: device.status,
      deviceBelongsToUser: device.userId === input.userId,
      approvedCount,
      deviceLimit,
    })
  ) {
    throw new InitialActivationConflictError();
  }

  const passwordAuditId = crypto.randomUUID();
  const deviceAuditId = crypto.randomUUID();
  const passwordAuditMetadata = JSON.stringify({
    forced: true,
    initialActivation: true,
  });
  const deviceAuditMetadata = JSON.stringify({
    source: "initial_password_activation",
    deviceRecordId: device.id,
    approvedAutomatically: true,
    actor: "staff_self",
    actorType: "system",
  });

  const userClaimSql = sql`
    EXISTS (
      SELECT 1 FROM users
      WHERE id = ${input.userId}
        AND must_change_password = 0
        AND initial_device_auto_approval_eligible = 0
        AND password_hash = ${input.passwordHash}
        AND password_changed_at = ${input.now}
    )
  `;

  const activationStateGuardSql = sql`
    EXISTS (
      SELECT 1 FROM authorized_devices
      WHERE id = ${device.id}
        AND user_id = ${input.userId}
        AND device_id_hash = ${input.deviceIdHash}
        AND status = 'approved'
        AND approved_at = ${input.now}
    )
    AND EXISTS (
      SELECT 1 FROM sessions
      WHERE id = ${input.sessionId}
        AND user_id = ${input.userId}
        AND device_id_hash = ${input.deviceIdHash}
        AND revoked_at = ${input.now}
    )
  `;

  const batchResults = (await database.batch([
    database
      .update(schema.users)
      .set({
        passwordHash: input.passwordHash,
        mustChangePassword: 0,
        passwordChangedAt: input.now,
        initialDeviceAutoApprovalEligible: 0,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(schema.users.id, input.userId),
          eq(schema.users.role, "staff"),
          eq(schema.users.mustChangePassword, 1),
          eq(schema.users.initialDeviceAutoApprovalEligible, 1),
          eq(schema.users.isActive, 1),
          sql`(SELECT COUNT(*) FROM authorized_devices WHERE user_id = ${input.userId} AND status = 'approved') = 0`,
          sql`EXISTS (
            SELECT 1 FROM authorized_devices
            WHERE user_id = ${input.userId}
              AND device_id_hash = ${input.deviceIdHash}
              AND status = 'pending'
          )`,
        ),
      ),
    database
      .update(schema.authorizedDevices)
      .set({
        status: "approved",
        approvedBy: null,
        approvedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(schema.authorizedDevices.id, device.id),
          eq(schema.authorizedDevices.userId, input.userId),
          eq(schema.authorizedDevices.deviceIdHash, input.deviceIdHash),
          eq(schema.authorizedDevices.status, "pending"),
          // Bind approval to THIS password claim so a concurrent loser cannot
          // approve a second device after the winner already activated the user.
          userClaimSql,
        ),
      ),
    database
      .update(schema.sessions)
      .set({ revokedAt: input.now })
      .where(
        and(
          eq(schema.sessions.id, input.sessionId),
          eq(schema.sessions.userId, input.userId),
          eq(schema.sessions.deviceIdHash, input.deviceIdHash),
          // Re-stamp revoked_at to this now when the user claim holds so audit
          // rows can bind to this operation even if the session was already
          // revoked (e.g. single-session replacement).
          userClaimSql,
        ),
      ),
    database.insert(schema.auditLogs).select(
      buildPasswordChangedAuditSelect({
        auditId: passwordAuditId,
        userId: input.userId,
        passwordHash: input.passwordHash,
        now: input.now,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadataJson: passwordAuditMetadata,
        extraGuardSql: activationStateGuardSql,
      }),
    ),
    database.insert(schema.auditLogs).select(
      sql`
        SELECT
          ${deviceAuditId} AS id,
          ${input.userId} AS user_id,
          ${DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION} AS action,
          ${"authorized_device"} AS entity_type,
          ${device.id} AS entity_id,
          ${input.ipAddress ?? null} AS ip_address,
          ${input.userAgent ?? null} AS user_agent,
          ${deviceAuditMetadata} AS metadata,
          ${input.now} AS created_at
        FROM users
        WHERE users.id = ${input.userId}
          AND users.password_hash = ${input.passwordHash}
          AND users.must_change_password = 0
          AND users.initial_device_auto_approval_eligible = 0
          AND users.password_changed_at = ${input.now}
          AND EXISTS (
            SELECT 1 FROM authorized_devices
            WHERE id = ${device.id}
              AND user_id = ${input.userId}
              AND device_id_hash = ${input.deviceIdHash}
              AND status = 'approved'
              AND approved_at = ${input.now}
          )
          AND EXISTS (
            SELECT 1 FROM sessions
            WHERE id = ${input.sessionId}
              AND user_id = ${input.userId}
              AND device_id_hash = ${input.deviceIdHash}
              AND revoked_at = ${input.now}
          )
          AND NOT EXISTS (
            SELECT 1 FROM audit_logs
            WHERE action = ${DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION}
              AND entity_id = ${device.id}
              AND created_at = ${input.now}
          )
      `,
    ),
  ] as unknown as Parameters<Database["batch"]>[0])) as unknown as unknown[];

  // All five statements must affect exactly one row for THIS request.
  assertBatchChanges(batchResults, [1, 1, 1, 1, 1]);

  const afterUser = (
    await database
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1)
  )[0];
  const afterDevice = await getAuthorizedDeviceByUserAndHash(
    input.userId,
    input.deviceIdHash,
    database,
  );
  const afterSession = (
    await database
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, input.sessionId))
      .limit(1)
  )[0];

  const passwordAudits = await database
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, "auth.password_changed"),
        eq(schema.auditLogs.entityId, input.userId),
        eq(schema.auditLogs.createdAt, input.now),
      ),
    );
  const deviceAudits = await database
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(
          schema.auditLogs.action,
          DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION,
        ),
        eq(schema.auditLogs.entityId, device.id),
        eq(schema.auditLogs.createdAt, input.now),
      ),
    );

  if (
    !afterUser ||
    afterUser.passwordHash !== input.passwordHash ||
    afterUser.mustChangePassword !== 0 ||
    afterUser.initialDeviceAutoApprovalEligible !== 0 ||
    afterUser.passwordChangedAt !== input.now ||
    afterDevice?.status !== "approved" ||
    afterDevice.id !== device.id ||
    afterDevice.approvedAt !== input.now ||
    afterSession?.revokedAt !== input.now ||
    passwordAudits.length !== 1 ||
    deviceAudits.length !== 1
  ) {
    throw new InitialActivationConflictError();
  }

  return { deviceRecordId: device.id };
}

/**
 * Forced password change while eligible, but device authorization is off
 * (or auto-approve is not applicable): consume eligibility without approving.
 */
export async function completeForcedPasswordChangeConsumingEligibility(
  input: {
    userId: string;
    sessionId: string | null;
    passwordHash: string;
    now: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    deviceAuthorizationEnabled: boolean;
  },
  db?: Database,
): Promise<void> {
  const database = db ?? getDb();
  const passwordAuditId = crypto.randomUUID();
  const passwordAuditMetadata = JSON.stringify({
    forced: true,
    initialActivation: false,
    initialEligibilityConsumed: true,
    deviceAuthorizationEnabled: input.deviceAuthorizationEnabled,
  });

  const userClaimSql = sql`
    EXISTS (
      SELECT 1 FROM users
      WHERE id = ${input.userId}
        AND must_change_password = 0
        AND initial_device_auto_approval_eligible = 0
        AND password_hash = ${input.passwordHash}
        AND password_changed_at = ${input.now}
    )
  `;

  const sessionGuardSql = input.sessionId
    ? sql`
        EXISTS (
          SELECT 1 FROM sessions
          WHERE id = ${input.sessionId}
            AND user_id = ${input.userId}
            AND revoked_at = ${input.now}
        )
      `
    : sql`1`;

  const statements = [
    database
      .update(schema.users)
      .set({
        passwordHash: input.passwordHash,
        mustChangePassword: 0,
        passwordChangedAt: input.now,
        initialDeviceAutoApprovalEligible: 0,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(schema.users.id, input.userId),
          eq(schema.users.mustChangePassword, 1),
          eq(schema.users.initialDeviceAutoApprovalEligible, 1),
          eq(schema.users.isActive, 1),
        ),
      ),
    ...(input.sessionId
      ? [
          database
            .update(schema.sessions)
            .set({ revokedAt: input.now })
            .where(
              and(
                eq(schema.sessions.id, input.sessionId),
                eq(schema.sessions.userId, input.userId),
                // Allow re-stamp when already revoked so audit can bind to now.
                userClaimSql,
              ),
            ),
        ]
      : []),
    database.insert(schema.auditLogs).select(
      buildPasswordChangedAuditSelect({
        auditId: passwordAuditId,
        userId: input.userId,
        passwordHash: input.passwordHash,
        now: input.now,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadataJson: passwordAuditMetadata,
        extraGuardSql: sessionGuardSql,
      }),
    ),
  ];

  const batchResults = (await database.batch(
    statements as unknown as Parameters<Database["batch"]>[0],
  )) as unknown as unknown[];

  const expectedChanges = input.sessionId ? [1, 1, 1] : [1, 1];
  assertBatchChanges(batchResults, expectedChanges);

  const afterUser = (
    await database
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1)
  )[0];
  if (
    !afterUser ||
    afterUser.passwordHash !== input.passwordHash ||
    afterUser.mustChangePassword !== 0 ||
    afterUser.initialDeviceAutoApprovalEligible !== 0 ||
    afterUser.passwordChangedAt !== input.now
  ) {
    throw new InitialActivationConflictError();
  }

  if (input.sessionId) {
    const afterSession = (
      await database
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, input.sessionId))
        .limit(1)
    )[0];
    if (afterSession?.revokedAt !== input.now) {
      throw new InitialActivationConflictError();
    }
  }

  const passwordAudits = await database
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, "auth.password_changed"),
        eq(schema.auditLogs.entityId, input.userId),
        eq(schema.auditLogs.createdAt, input.now),
      ),
    );
  if (passwordAudits.length !== 1) {
    throw new InitialActivationConflictError();
  }

  const activationAudits = await database
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.userId, input.userId),
        eq(
          schema.auditLogs.action,
          DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION,
        ),
      ),
    );
  if (activationAudits.length !== 0) {
    throw new InitialActivationConflictError();
  }
}
