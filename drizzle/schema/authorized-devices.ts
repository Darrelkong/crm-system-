import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const AUTHORIZED_DEVICE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "revoked",
] as const;

export type AuthorizedDeviceStatus =
  (typeof AUTHORIZED_DEVICE_STATUSES)[number];

export const authorizedDevices = sqliteTable(
  "authorized_devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceIdHash: text("device_id_hash").notNull(),
    deviceName: text("device_name"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    status: text("status", {
      enum: AUTHORIZED_DEVICE_STATUSES,
    }).notNull(),
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: text("approved_at"),
    revokedAt: text("revoked_at"),
    lastSeenAt: text("last_seen_at"),
    lastSeenIp: text("last_seen_ip"),
    lastSeenUserAgent: text("last_seen_user_agent"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_authorized_devices_user_hash").on(
      table.userId,
      table.deviceIdHash,
    ),
    index("idx_authorized_devices_status").on(table.status),
    index("idx_authorized_devices_user_status").on(
      table.userId,
      table.status,
    ),
    index("idx_authorized_devices_created_at").on(table.createdAt),
  ],
);

export type AuthorizedDevice = typeof authorizedDevices.$inferSelect;
export type NewAuthorizedDevice = typeof authorizedDevices.$inferInsert;
