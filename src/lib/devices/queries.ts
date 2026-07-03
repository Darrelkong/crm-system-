import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import { getSystemSettings } from "@/lib/settings/service";
import { DEFAULT_DEVICE_AUTHORIZATION_LIMIT } from "@/lib/devices/constants";
import type { AuthorizedDevice } from "../../../drizzle/schema/authorized-devices";
import { summarizeUserAgent } from "@/lib/devices/ua-summary";
import type { DeviceListItem } from "@/lib/devices/types";

export async function isDeviceAuthorizationEnabled(
  db?: Database,
): Promise<boolean> {
  const settings = await getSystemSettings(db);
  return settings.device_authorization_enabled === "true";
}

export async function getDeviceAuthorizationLimit(
  db?: Database,
): Promise<number> {
  const settings = await getSystemSettings(db);
  const raw =
    settings.device_authorization_limit_per_user ??
    SETTING_DEFAULTS.device_authorization_limit_per_user;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    return DEFAULT_DEVICE_AUTHORIZATION_LIMIT;
  }
  return n;
}

export async function countApprovedDevicesForUser(
  userId: string,
  db?: Database,
): Promise<number> {
  const database = db ?? getDb();
  const rows = await database
    .select({ count: sql<number>`count(*)` })
    .from(schema.authorizedDevices)
    .where(
      and(
        eq(schema.authorizedDevices.userId, userId),
        eq(schema.authorizedDevices.status, "approved"),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

export async function getAuthorizedDeviceByUserAndHash(
  userId: string,
  deviceIdHash: string,
  db?: Database,
): Promise<AuthorizedDevice | null> {
  const database = db ?? getDb();
  const rows = await database
    .select()
    .from(schema.authorizedDevices)
    .where(
      and(
        eq(schema.authorizedDevices.userId, userId),
        eq(schema.authorizedDevices.deviceIdHash, deviceIdHash),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getAuthorizedDeviceById(
  deviceId: string,
  db?: Database,
): Promise<AuthorizedDevice | null> {
  const database = db ?? getDb();
  const rows = await database
    .select()
    .from(schema.authorizedDevices)
    .where(eq(schema.authorizedDevices.id, deviceId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listAuthorizedDevicesForAdmin(
  filters: {
    status?: string;
    userId?: string;
    email?: string;
    limit?: number;
  },
  db?: Database,
): Promise<DeviceListItem[]> {
  const database = db ?? getDb();
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);

  const conditions = [];
  if (
    filters.status &&
    ["pending", "approved", "rejected", "revoked"].includes(filters.status)
  ) {
    conditions.push(
      eq(
        schema.authorizedDevices.status,
        filters.status as AuthorizedDevice["status"],
      ),
    );
  }
  if (filters.userId) {
    conditions.push(eq(schema.authorizedDevices.userId, filters.userId));
  }
  if (filters.email?.trim()) {
    conditions.push(
      eq(schema.users.email, filters.email.trim().toLowerCase()),
    );
  }

  const rows = await database
    .select({
      device: schema.authorizedDevices,
      userDisplayName: schema.users.displayName,
      userEmail: schema.users.email,
    })
    .from(schema.authorizedDevices)
    .innerJoin(
      schema.users,
      eq(schema.authorizedDevices.userId, schema.users.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.authorizedDevices.createdAt))
    .limit(limit);

  const approverIds = [
    ...new Set(
      rows
        .map((row) => row.device.approvedBy)
        .filter((id): id is string => id != null),
    ),
  ];

  const approverNameById = new Map<string, string>();
  if (approverIds.length > 0) {
    const approvers = await database
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, approverIds));
    for (const approver of approvers) {
      approverNameById.set(approver.id, approver.displayName);
    }
  }

  return rows.map((row) => ({
    id: row.device.id,
    user_id: row.device.userId,
    user_display_name: row.userDisplayName,
    user_email: row.userEmail,
    device_id_hash: row.device.deviceIdHash,
    device_name: row.device.deviceName,
    user_agent: row.device.userAgent,
    user_agent_summary: summarizeUserAgent(row.device.userAgent),
    ip_address: row.device.ipAddress,
    status: row.device.status,
    approved_by: row.device.approvedBy,
    approved_by_name: row.device.approvedBy
      ? (approverNameById.get(row.device.approvedBy) ?? null)
      : null,
    approved_at: row.device.approvedAt,
    revoked_at: row.device.revokedAt,
    last_seen_at: row.device.lastSeenAt,
    last_seen_ip: row.device.lastSeenIp,
    created_at: row.device.createdAt,
    updated_at: row.device.updatedAt,
  }));
}
