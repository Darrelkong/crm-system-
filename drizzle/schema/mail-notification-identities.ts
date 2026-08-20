import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const MAIL_NOTIFICATION_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "revoked",
] as const;

export type MailNotificationVerificationStatus =
  (typeof MAIL_NOTIFICATION_VERIFICATION_STATUSES)[number];

export const MAIL_NOTIFICATION_DELIVERY_HEALTH = [
  "unknown",
  "healthy",
  "temporary_problem",
  "bounced",
] as const;

export type MailNotificationDeliveryHealth =
  (typeof MAIL_NOTIFICATION_DELIVERY_HEALTH)[number];

/**
 * Verification and delivery health are independent.
 * Mail access requires verified identity; delivery bounce does not revoke access.
 *
 * Email replacement: old verified + new pending may coexist (partial uniques).
 *
 * Atomic switch on verify (single transaction; order is mandatory):
 *   1. Validate new pending verification token.
 *   2. Revoke the currently verified identity.
 *   3. Promote the new pending identity to verified.
 * Promoting before revoking violates uq_mail_notification_identities_user_verified_active.
 *
 * Active pending/verified emails are unique case-insensitively (lower(email) index).
 */
export const mailNotificationIdentities = sqliteTable(
  "mail_notification_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    email: text("email").notNull(),
    verificationStatus: text("verification_status", {
      enum: MAIL_NOTIFICATION_VERIFICATION_STATUSES,
    })
      .notNull()
      .default("pending"),
    verificationTokenHash: text("verification_token_hash"),
    verificationRequestedAt: text("verification_requested_at"),
    verificationExpiresAt: text("verification_expires_at"),
    verifiedAt: text("verified_at"),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    revokeReason: text("revoke_reason"),
    deliveryHealth: text("delivery_health", {
      enum: MAIL_NOTIFICATION_DELIVERY_HEALTH,
    })
      .notNull()
      .default("unknown"),
    deliveryProblemAt: text("delivery_problem_at"),
    lastDeliveryStatus: text("last_delivery_status"),
    lastDeliveryAt: text("last_delivery_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_mail_notification_identities_user_id").on(table.userId),
    index("idx_mail_notification_identities_email").on(table.email),
    index("idx_mail_notification_identities_verification").on(
      table.userId,
      table.verificationStatus,
    ),
    index("idx_mail_notification_identities_delivery_health").on(
      table.deliveryHealth,
    ),
    uniqueIndex("uq_mail_notification_identities_user_verified_active")
      .on(table.userId)
      .where(
        sql`${table.verificationStatus} = 'verified' AND ${table.revokedAt} IS NULL`,
      ),
    uniqueIndex("uq_mail_notification_identities_user_pending_active")
      .on(table.userId)
      .where(
        sql`${table.verificationStatus} = 'pending' AND ${table.revokedAt} IS NULL`,
      ),
    uniqueIndex("uq_mail_notification_identities_email_active")
      .on(sql`lower(${table.email})`)
      .where(
        sql`${table.verificationStatus} IN ('pending', 'verified') AND ${table.revokedAt} IS NULL`,
      ),
  ],
);

export type MailNotificationIdentity =
  typeof mailNotificationIdentities.$inferSelect;
export type NewMailNotificationIdentity =
  typeof mailNotificationIdentities.$inferInsert;
