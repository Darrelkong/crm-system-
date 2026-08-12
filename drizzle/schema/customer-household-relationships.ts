import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { customerHouseholds } from "./customer-households";
import {
  HOUSEHOLD_RELATIONSHIP_TYPES,
  type HouseholdRelationshipType,
} from "./household-relationship-types";
import { users } from "./users";

export { HOUSEHOLD_RELATIONSHIP_TYPES, type HouseholdRelationshipType };

/**
 * One explicit directed relationship between two Customers in the same Household.
 * Same-household membership is enforced by future transactional write services (B4/B6).
 */
export const customerHouseholdRelationships = sqliteTable(
  "customer_household_relationships",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => customerHouseholds.id),
    fromCustomerId: text("from_customer_id")
      .notNull()
      .references(() => customers.id),
    toCustomerId: text("to_customer_id")
      .notNull()
      .references(() => customers.id),
    relationshipType: text("relationship_type", {
      enum: HOUSEHOLD_RELATIONSHIP_TYPES,
    }).notNull(),
    remark: text("remark"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_customer_household_relationships_directed").on(
      table.householdId,
      table.fromCustomerId,
      table.toCustomerId,
    ),
    index("idx_customer_household_relationships_household_id").on(
      table.householdId,
    ),
    index("idx_customer_household_relationships_from_customer_id").on(
      table.fromCustomerId,
    ),
    index("idx_customer_household_relationships_to_customer_id").on(
      table.toCustomerId,
    ),
  ],
);

export type CustomerHouseholdRelationship =
  typeof customerHouseholdRelationships.$inferSelect;
export type NewCustomerHouseholdRelationship =
  typeof customerHouseholdRelationships.$inferInsert;
