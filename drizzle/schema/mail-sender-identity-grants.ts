import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { mailSenderIdentities } from "./mail-sender-identities";

/**
 * Authorized From identities per user.
 * Does not grant mailbox membership; both are required for send/reply (AND).
 */
export const mailSenderIdentityGrants = sqliteTable(
  "mail_sender_identity_grants",
  {
    id: text("id").primaryKey(),
    senderIdentityId: text("sender_identity_id")
      .notNull()
      .references(() => mailSenderIdentities.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    canReply: integer("can_reply").notNull().default(0),
    canSend: integer("can_send").notNull().default(0),
    grantedBy: text("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_mail_sender_identity_grants_user_id").on(table.userId),
    index("idx_mail_sender_identity_grants_identity_id").on(
      table.senderIdentityId,
    ),
    uniqueIndex("uq_mail_sender_identity_grants_identity_user_active")
      .on(table.senderIdentityId, table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export type MailSenderIdentityGrant =
  typeof mailSenderIdentityGrants.$inferSelect;
export type NewMailSenderIdentityGrant =
  typeof mailSenderIdentityGrants.$inferInsert;
