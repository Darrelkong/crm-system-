import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import {
  DEVICE_AUDIT_ACTIONS,
  DEVICE_LOGIN_MESSAGES,
} from "@/lib/devices/constants";
import {
  countApprovedDevicesForUser,
  getAuthorizedDeviceById,
  getAuthorizedDeviceByUserAndHash,
  getDeviceAuthorizationLimit,
  isDeviceAuthorizationEnabled,
} from "@/lib/devices/queries";
import {
  buildConsumeInitialDeviceAutoApprovalEligibilityStatement,
  canCreateInitialActivationRestrictedSession,
} from "@/lib/devices/initial-device-auto-approval";
import { defaultDeviceName } from "@/lib/devices/ua-summary";
import type { DeviceLoginBlockReason } from "@/lib/devices/types";
import type { AuthorizedDevice } from "../../../drizzle/schema/authorized-devices";
import type { User } from "../../../drizzle/schema/users";
import { revokeSessionsForUserDevice } from "@/lib/auth/session-policy";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type DeviceLoginAllow = {
  ok: true;
  deviceRecordId: string;
  deviceIdHash: string;
};

export type DeviceLoginBlock = {
  ok: false;
  errorCode: string;
  message: string;
  reason: DeviceLoginBlockReason;
  deviceRecordId?: string;
};

export type DeviceLoginResult = DeviceLoginAllow | DeviceLoginBlock;

function tryInitialActivationRestrictedAllow(
  user: User,
  deviceRecordId: string,
  deviceIdHash: string,
  approvedCount: number,
  deviceLimit: number,
): DeviceLoginAllow | null {
  if (
    !canCreateInitialActivationRestrictedSession({
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      initialDeviceAutoApprovalEligible:
        user.initialDeviceAutoApprovalEligible,
      deviceAuthorizationEnabled: true,
      deviceStatus: "pending",
      deviceBelongsToUser: true,
      approvedCount,
      deviceLimit,
    })
  ) {
    return null;
  }
  return { ok: true, deviceRecordId, deviceIdHash };
}

export class DeviceAdminError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "DeviceAdminError";
  }
}

async function writeDeviceAudit(
  input: {
    actorUserId?: string | null;
    action: string;
    entityId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  },
  db?: Database,
): Promise<void> {
  await writeAuditLog(
    {
      userId: input.actorUserId ?? null,
      action: input.action,
      entityType: "authorized_device",
      entityId: input.entityId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? null,
    },
    db,
  );
}

async function resetDeviceToPending(
  device: AuthorizedDevice,
  meta: RequestMeta,
  db: Database,
): Promise<void> {
  const now = new Date().toISOString();
  const newDeviceName = meta.userAgent
    ? defaultDeviceName(meta.userAgent)
    : (device.deviceName ?? null);
  await db
    .update(schema.authorizedDevices)
    .set({
      status: "pending",
      approvedBy: null,
      approvedAt: null,
      revokedAt: null,
      userAgent: meta.userAgent ?? device.userAgent,
      ipAddress: meta.ipAddress ?? device.ipAddress,
      deviceName: newDeviceName,
      lastSeenIp: meta.ipAddress ?? device.lastSeenIp,
      lastSeenUserAgent: meta.userAgent ?? device.lastSeenUserAgent,
      updatedAt: now,
    })
    .where(eq(schema.authorizedDevices.id, device.id));
}

async function touchApprovedDevice(
  device: AuthorizedDevice,
  meta: RequestMeta,
  db: Database,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(schema.authorizedDevices)
    .set({
      lastSeenAt: now,
      lastSeenIp: meta.ipAddress ?? null,
      lastSeenUserAgent: meta.userAgent ?? null,
      updatedAt: now,
    })
    .where(eq(schema.authorizedDevices.id, device.id));
}

async function insertPendingDevice(
  user: User,
  deviceIdHash: string,
  meta: RequestMeta,
  db: Database,
): Promise<AuthorizedDevice> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const deviceName = defaultDeviceName(meta.userAgent);

  await db.insert(schema.authorizedDevices).values({
    id,
    userId: user.id,
    deviceIdHash,
    deviceName,
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
    status: "pending",
    approvedBy: null,
    approvedAt: null,
    revokedAt: null,
    lastSeenAt: null,
    lastSeenIp: null,
    lastSeenUserAgent: null,
    createdAt: now,
    updatedAt: now,
  });

  const created = await getAuthorizedDeviceById(id, db);
  if (!created) {
    throw new Error("Failed to create pending device record");
  }
  return created;
}

/** Admin login: always upsert an approved device record for audit. */
export async function recordAdminDeviceOnLogin(
  user: User,
  deviceIdHash: string,
  meta: RequestMeta,
  db?: Database,
): Promise<string> {
  const database = db ?? getDb();
  const now = new Date().toISOString();
  const existing = await getAuthorizedDeviceByUserAndHash(
    user.id,
    deviceIdHash,
    database,
  );

  if (existing) {
    await database
      .update(schema.authorizedDevices)
      .set({
        status: "approved",
        lastSeenAt: now,
        lastSeenIp: meta.ipAddress ?? null,
        lastSeenUserAgent: meta.userAgent ?? null,
        updatedAt: now,
        deviceName: existing.deviceName ?? defaultDeviceName(meta.userAgent),
      })
      .where(eq(schema.authorizedDevices.id, existing.id));

    await writeDeviceAudit(
      {
        actorUserId: user.id,
        action: DEVICE_AUDIT_ACTIONS.ADMIN_RECORDED,
        entityId: existing.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          targetUserId: user.id,
          targetUserEmail: user.email,
          deviceRecordId: existing.id,
          deviceName: existing.deviceName,
          userAgentSummary: defaultDeviceName(meta.userAgent),
          ipAddress: meta.ipAddress,
        },
      },
      database,
    );
    return existing.id;
  }

  const id = crypto.randomUUID();
  const deviceName = defaultDeviceName(meta.userAgent);
  await database.insert(schema.authorizedDevices).values({
    id,
    userId: user.id,
    deviceIdHash,
    deviceName,
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
    status: "approved",
    approvedBy: user.id,
    approvedAt: now,
    revokedAt: null,
    lastSeenAt: now,
    lastSeenIp: meta.ipAddress ?? null,
    lastSeenUserAgent: meta.userAgent ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await writeDeviceAudit(
    {
      actorUserId: user.id,
      action: DEVICE_AUDIT_ACTIONS.ADMIN_RECORDED,
      entityId: id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        targetUserId: user.id,
        targetUserEmail: user.email,
        deviceRecordId: id,
        deviceName,
        userAgentSummary: deviceName,
        ipAddress: meta.ipAddress,
      },
    },
    database,
  );

  return id;
}

export async function evaluateStaffDeviceLogin(
  user: User,
  deviceIdHash: string,
  meta: RequestMeta,
  db?: Database,
): Promise<DeviceLoginResult> {
  const database = db ?? getDb();
  const enabled = await isDeviceAuthorizationEnabled(database);
  if (!enabled) {
    return { ok: true, deviceRecordId: "", deviceIdHash };
  }

  const existing = await getAuthorizedDeviceByUserAndHash(
    user.id,
    deviceIdHash,
    database,
  );

  if (!existing) {
    const limit = await getDeviceAuthorizationLimit(database);
    const approvedCount = await countApprovedDevicesForUser(user.id, database);
    const atLimit = approvedCount >= limit;

    const created = await insertPendingDevice(
      user,
      deviceIdHash,
      meta,
      database,
    );

    await writeDeviceAudit(
      {
        actorUserId: user.id,
        action: DEVICE_AUDIT_ACTIONS.CREATED_PENDING,
        entityId: created.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          targetUserId: user.id,
          targetUserEmail: user.email,
          deviceRecordId: created.id,
          deviceName: created.deviceName,
          userAgentSummary: defaultDeviceName(meta.userAgent),
          ipAddress: meta.ipAddress,
          reason: atLimit ? "limit_reached" : "new_device",
        },
      },
      database,
    );

    const restrictedAllow = tryInitialActivationRestrictedAllow(
      user,
      created.id,
      deviceIdHash,
      approvedCount,
      limit,
    );
    if (restrictedAllow) {
      return restrictedAllow;
    }

    await writeDeviceAudit(
      {
        actorUserId: user.id,
        action: DEVICE_AUDIT_ACTIONS.LOGIN_BLOCKED,
        entityId: created.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          targetUserId: user.id,
          targetUserEmail: user.email,
          deviceRecordId: created.id,
          deviceName: created.deviceName,
          reason: atLimit ? "limit_reached" : "new_pending",
        },
      },
      database,
    );

    if (atLimit) {
      return {
        ok: false,
        errorCode: AUTH_ERROR_CODES.DEVICE_LIMIT_REACHED,
        message: DEVICE_LOGIN_MESSAGES.LIMIT_REACHED,
        reason: "limit_reached",
        deviceRecordId: created.id,
      };
    }

    return {
      ok: false,
      errorCode: AUTH_ERROR_CODES.DEVICE_NEW_PENDING,
      message: DEVICE_LOGIN_MESSAGES.NEW_PENDING,
      reason: "new_pending",
      deviceRecordId: created.id,
    };
  }

  if (existing.status === "approved") {
    await touchApprovedDevice(existing, meta, database);
    return {
      ok: true,
      deviceRecordId: existing.id,
      deviceIdHash,
    };
  }

  if (existing.status === "pending") {
    const limit = await getDeviceAuthorizationLimit(database);
    const approvedCount = await countApprovedDevicesForUser(user.id, database);
    const restrictedAllow = tryInitialActivationRestrictedAllow(
      user,
      existing.id,
      deviceIdHash,
      approvedCount,
      limit,
    );
    if (restrictedAllow) {
      return restrictedAllow;
    }

    await writeDeviceAudit(
      {
        actorUserId: user.id,
        action: DEVICE_AUDIT_ACTIONS.LOGIN_BLOCKED,
        entityId: existing.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          targetUserId: user.id,
          targetUserEmail: user.email,
          deviceRecordId: existing.id,
          deviceName: existing.deviceName,
          reason: "pending",
        },
      },
      database,
    );
    return {
      ok: false,
      errorCode: AUTH_ERROR_CODES.DEVICE_PENDING_REVIEW,
      message: DEVICE_LOGIN_MESSAGES.PENDING_REVIEW,
      reason: "pending",
      deviceRecordId: existing.id,
    };
  }

  // Device is revoked or rejected: reset to pending so admin can re-approve.
  const previousStatus = existing.status;
  await resetDeviceToPending(existing, meta, database);

  await writeDeviceAudit(
    {
      actorUserId: user.id,
      action: DEVICE_AUDIT_ACTIONS.REAPPROVAL_REQUESTED,
      entityId: existing.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        targetUserId: user.id,
        targetUserEmail: user.email,
        deviceRecordId: existing.id,
        deviceName: existing.deviceName,
        previousStatus,
      },
    },
    database,
  );

  const limit = await getDeviceAuthorizationLimit(database);
  const approvedCount = await countApprovedDevicesForUser(user.id, database);
  const restrictedAllow = tryInitialActivationRestrictedAllow(
    user,
    existing.id,
    deviceIdHash,
    approvedCount,
    limit,
  );
  if (restrictedAllow) {
    return restrictedAllow;
  }

  await writeDeviceAudit(
    {
      actorUserId: user.id,
      action: DEVICE_AUDIT_ACTIONS.LOGIN_BLOCKED,
      entityId: existing.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        targetUserId: user.id,
        targetUserEmail: user.email,
        deviceRecordId: existing.id,
        deviceName: existing.deviceName,
        reason: "reapproval_pending",
      },
    },
    database,
  );

  return {
    ok: false,
    errorCode: AUTH_ERROR_CODES.DEVICE_REAPPROVAL_PENDING,
    message: DEVICE_LOGIN_MESSAGES.REAPPROVAL_PENDING,
    reason: "reapproval_pending",
    deviceRecordId: existing.id,
  };
}

export async function isDeviceApprovedForSession(
  userId: string,
  deviceIdHash: string,
  db?: Database,
): Promise<boolean> {
  const database = db ?? getDb();
  const enabled = await isDeviceAuthorizationEnabled(database);
  if (!enabled) {
    return true;
  }
  const device = await getAuthorizedDeviceByUserAndHash(
    userId,
    deviceIdHash,
    database,
  );
  return device?.status === "approved";
}

/**
 * Staff session device gate: Approved always allowed; Pending allowed only
 * while the user still qualifies for the initial-activation restricted session.
 */
export async function isDeviceAllowedForStaffSession(
  user: Pick<
    User,
    | "id"
    | "role"
    | "mustChangePassword"
    | "initialDeviceAutoApprovalEligible"
  >,
  deviceIdHash: string,
  db?: Database,
): Promise<boolean> {
  const database = db ?? getDb();
  const enabled = await isDeviceAuthorizationEnabled(database);
  if (!enabled) {
    return true;
  }

  const device = await getAuthorizedDeviceByUserAndHash(
    user.id,
    deviceIdHash,
    database,
  );
  if (device?.status === "approved") {
    return true;
  }
  if (device?.status !== "pending") {
    return false;
  }

  const approvedCount = await countApprovedDevicesForUser(user.id, database);
  const deviceLimit = await getDeviceAuthorizationLimit(database);
  return canCreateInitialActivationRestrictedSession({
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    initialDeviceAutoApprovalEligible:
      user.initialDeviceAutoApprovalEligible,
    deviceAuthorizationEnabled: true,
    deviceStatus: "pending",
    deviceBelongsToUser: true,
    approvedCount,
    deviceLimit,
  });
}

export async function approveAuthorizedDevice(
  actor: User,
  deviceRecordId: string,
  meta: RequestMeta,
  db?: Database,
): Promise<void> {
  const database = db ?? getDb();
  const device = await getAuthorizedDeviceById(deviceRecordId, database);
  if (!device) {
    throw new DeviceAdminError("not_found", "設備記錄不存在", 404);
  }
  if (device.status !== "pending") {
    throw new DeviceAdminError(
      "invalid_status",
      "只能批准待審核的設備",
    );
  }

  const targetUser = await database
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, device.userId))
    .limit(1);
  const user = targetUser[0];
  if (!user || user.role === "admin") {
    throw new DeviceAdminError("invalid_target", "無效的員工設備");
  }

  const limit = await getDeviceAuthorizationLimit(database);
  const approvedCount = await countApprovedDevicesForUser(device.userId, database);
  if (approvedCount >= limit) {
    throw new DeviceAdminError(
      "limit_reached",
      `該員工已達設備上限（${limit} 台），請先撤銷舊設備`,
    );
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  await database.batch([
    database
      .update(schema.authorizedDevices)
      .set({
        status: "approved",
        approvedBy: actor.id,
        approvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.authorizedDevices.id, deviceRecordId),
          eq(schema.authorizedDevices.status, "pending"),
        ),
      ),
    buildConsumeInitialDeviceAutoApprovalEligibilityStatement(
      database,
      device.userId,
      now,
    ),
    database.insert(schema.auditLogs).values({
      id: auditId,
      userId: actor.id,
      action: DEVICE_AUDIT_ACTIONS.APPROVED,
      entityType: "authorized_device",
      entityId: deviceRecordId,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: JSON.stringify({
        targetUserId: user.id,
        targetUserEmail: user.email,
        deviceRecordId,
        deviceName: device.deviceName,
        ipAddress: meta.ipAddress,
      }),
      createdAt: now,
    }),
  ] as unknown as Parameters<Database["batch"]>[0]);
}

export async function rejectAuthorizedDevice(
  actor: User,
  deviceRecordId: string,
  meta: RequestMeta,
  db?: Database,
): Promise<void> {
  const database = db ?? getDb();
  const device = await getAuthorizedDeviceById(deviceRecordId, database);
  if (!device) {
    throw new DeviceAdminError("not_found", "設備記錄不存在", 404);
  }
  if (device.status !== "pending") {
    throw new DeviceAdminError(
      "invalid_status",
      "只能拒絕待審核的設備",
    );
  }

  const targetUser = await database
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, device.userId))
    .limit(1);
  const user = targetUser[0];

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  await database.batch([
    database
      .update(schema.authorizedDevices)
      .set({
        status: "rejected",
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.authorizedDevices.id, deviceRecordId),
          eq(schema.authorizedDevices.status, "pending"),
        ),
      ),
    buildConsumeInitialDeviceAutoApprovalEligibilityStatement(
      database,
      device.userId,
      now,
    ),
    database.insert(schema.auditLogs).values({
      id: auditId,
      userId: actor.id,
      action: DEVICE_AUDIT_ACTIONS.REJECTED,
      entityType: "authorized_device",
      entityId: deviceRecordId,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: JSON.stringify({
        targetUserId: device.userId,
        targetUserEmail: user?.email,
        deviceRecordId,
        deviceName: device.deviceName,
      }),
      createdAt: now,
    }),
  ] as unknown as Parameters<Database["batch"]>[0]);
}

export async function revokeAuthorizedDevice(
  actor: User,
  deviceRecordId: string,
  meta: RequestMeta,
  db?: Database,
): Promise<void> {
  const database = db ?? getDb();
  const device = await getAuthorizedDeviceById(deviceRecordId, database);
  if (!device) {
    throw new DeviceAdminError("not_found", "設備記錄不存在", 404);
  }
  if (device.status !== "approved") {
    throw new DeviceAdminError(
      "invalid_status",
      "只能撤銷已批准的設備",
    );
  }

  const targetUser = await database
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, device.userId))
    .limit(1);
  const user = targetUser[0];

  const now = new Date().toISOString();
  const isAdminDevice = user?.role === "admin";
  const auditId = crypto.randomUUID();

  await database.batch([
    database
      .update(schema.authorizedDevices)
      .set({
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.authorizedDevices.id, deviceRecordId),
          eq(schema.authorizedDevices.status, "approved"),
        ),
      ),
    buildConsumeInitialDeviceAutoApprovalEligibilityStatement(
      database,
      device.userId,
      now,
    ),
    database.insert(schema.auditLogs).values({
      id: auditId,
      userId: actor.id,
      action: DEVICE_AUDIT_ACTIONS.REVOKED,
      entityType: "authorized_device",
      entityId: deviceRecordId,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: JSON.stringify({
        targetUserId: device.userId,
        targetUserEmail: user?.email,
        deviceRecordId,
        deviceName: device.deviceName,
        auditOnly: isAdminDevice,
      }),
      createdAt: now,
    }),
  ] as unknown as Parameters<Database["batch"]>[0]);

  // Admin sessions are not revoked when an admin device record is revoked —
  // device status is audit-only for admins and must not block their access.
  let revokedSessionCount = 0;
  if (!isAdminDevice) {
    revokedSessionCount = await revokeSessionsForUserDevice(
      database,
      device.userId,
      device.deviceIdHash,
      now,
    );
  }

  if (revokedSessionCount > 0) {
    await writeDeviceAudit(
      {
        actorUserId: actor.id,
        action: DEVICE_AUDIT_ACTIONS.SESSION_REVOKED,
        entityId: deviceRecordId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          targetUserId: device.userId,
          targetUserEmail: user?.email,
          deviceRecordId,
          revokedSessionCount,
        },
      },
      database,
    );
  }
}

export async function getDeviceSummariesForUsers(
  userIds: string[],
  db?: Database,
): Promise<Map<string, { approved_count: number; limit: number }>> {
  const database = db ?? getDb();
  const limit = await getDeviceAuthorizationLimit(database);
  const result = new Map<string, { approved_count: number; limit: number }>();

  for (const userId of userIds) {
    const approved_count = await countApprovedDevicesForUser(userId, database);
    result.set(userId, { approved_count, limit });
  }

  return result;
}
