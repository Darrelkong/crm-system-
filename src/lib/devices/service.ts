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

  const blockByStatus: Record<
    Exclude<AuthorizedDevice["status"], "approved">,
    { errorCode: string; message: string; reason: DeviceLoginBlockReason }
  > = {
    pending: {
      errorCode: AUTH_ERROR_CODES.DEVICE_PENDING_REVIEW,
      message: DEVICE_LOGIN_MESSAGES.PENDING_REVIEW,
      reason: "pending",
    },
    rejected: {
      errorCode: AUTH_ERROR_CODES.DEVICE_REJECTED,
      message: DEVICE_LOGIN_MESSAGES.REJECTED,
      reason: "rejected",
    },
    revoked: {
      errorCode: AUTH_ERROR_CODES.DEVICE_REVOKED,
      message: DEVICE_LOGIN_MESSAGES.REVOKED,
      reason: "revoked",
    },
  };

  const block = blockByStatus[existing.status];
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
        reason: block.reason,
      },
    },
    database,
  );

  return {
    ok: false,
    errorCode: block.errorCode,
    message: block.message,
    reason: block.reason,
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
  await database
    .update(schema.authorizedDevices)
    .set({
      status: "approved",
      approvedBy: actor.id,
      approvedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.authorizedDevices.id, deviceRecordId));

  await writeDeviceAudit(
    {
      actorUserId: actor.id,
      action: DEVICE_AUDIT_ACTIONS.APPROVED,
      entityId: deviceRecordId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        targetUserId: user.id,
        targetUserEmail: user.email,
        deviceRecordId,
        deviceName: device.deviceName,
        ipAddress: meta.ipAddress,
      },
    },
    database,
  );
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
  await database
    .update(schema.authorizedDevices)
    .set({
      status: "rejected",
      updatedAt: now,
    })
    .where(eq(schema.authorizedDevices.id, deviceRecordId));

  await writeDeviceAudit(
    {
      actorUserId: actor.id,
      action: DEVICE_AUDIT_ACTIONS.REJECTED,
      entityId: deviceRecordId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        targetUserId: device.userId,
        targetUserEmail: user?.email,
        deviceRecordId,
        deviceName: device.deviceName,
      },
    },
    database,
  );
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
  await database
    .update(schema.authorizedDevices)
    .set({
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.authorizedDevices.id, deviceRecordId));

  const revokedSessionCount = await revokeSessionsForUserDevice(
    database,
    device.userId,
    device.deviceIdHash,
    now,
  );

  await writeDeviceAudit(
    {
      actorUserId: actor.id,
      action: DEVICE_AUDIT_ACTIONS.REVOKED,
      entityId: deviceRecordId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        targetUserId: device.userId,
        targetUserEmail: user?.email,
        deviceRecordId,
        deviceName: device.deviceName,
      },
    },
    database,
  );

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
