import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CUSTOMER_RATINGS, CUSTOMER_RATING_ACTIONS } from "../../src/lib/customers/rating/domain";
import { customers } from "./customers";
import { followUps } from "./follow-ups";
import { users } from "./users";

const ratingsSql = sql.raw(CUSTOMER_RATINGS.map((r) => `'${r}'`).join(","));
const actionsSql = sql.raw(CUSTOMER_RATING_ACTIONS.map((a) => `'${a}'`).join(","));
export const customerRatingHistory = sqliteTable("customer_rating_history", {
  id: text("id").primaryKey().notNull(),
  customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  followUpId: text("follow_up_id").references(() => followUps.id, { onDelete: "set null" }),
  actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  ratingBefore: text("rating_before", { enum: CUSTOMER_RATINGS }),
  ratingAfter: text("rating_after", { enum: CUSTOMER_RATINGS }),
  action: text("action", { enum: CUSTOMER_RATING_ACTIONS }).notNull(),
  revisionBefore: integer("revision_before").notNull(),
  revisionAfter: integer("revision_after").notNull(),
  reason: text("reason"),
  recordedAt: text("recorded_at").notNull(),
}, (t) => [
  check("ck_rating_history_before", sql`${t.ratingBefore} IS NULL OR ${t.ratingBefore} IN (${ratingsSql})`),
  check("ck_rating_history_after", sql`${t.ratingAfter} IS NULL OR ${t.ratingAfter} IN (${ratingsSql})`),
  check("ck_rating_history_action", sql`${t.action} IN (${actionsSql})`),
  check("ck_rating_history_revision", sql`typeof(${t.revisionBefore}) = 'integer' AND typeof(${t.revisionAfter}) = 'integer' AND ${t.revisionBefore} >= 0 AND ${t.revisionAfter} = ${t.revisionBefore} + 1`),
  check("ck_rating_history_action_shape", sql`
    (${t.action} = 'follow_up_confirmed' AND ${t.ratingAfter} IS NOT NULL)
    OR (${t.action} = 'manual_correction' AND ${t.followUpId} IS NULL AND ${t.ratingAfter} IS NOT NULL AND ${t.reason} IS NOT NULL AND length(trim(${t.reason})) >= 5)
    OR (${t.action} = 'manual_clear' AND ${t.followUpId} IS NULL AND ${t.ratingBefore} IS NOT NULL AND ${t.ratingAfter} IS NULL AND ${t.reason} IS NOT NULL AND length(trim(${t.reason})) >= 5)`),
  uniqueIndex("uq_customer_rating_history_follow_up").on(t.followUpId).where(sql`${t.followUpId} IS NOT NULL`),
  index("idx_customer_rating_history_customer_recorded").on(t.customerId, t.recordedAt, t.id),
]);
export type CustomerRatingHistory = typeof customerRatingHistory.$inferSelect;
export type NewCustomerRatingHistory = typeof customerRatingHistory.$inferInsert;
