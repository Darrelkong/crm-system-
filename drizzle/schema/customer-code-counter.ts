import { integer, sqliteTable } from "drizzle-orm/sqlite-core";

export const customerCodeCounter = sqliteTable("customer_code_counter", {
  id: integer("id").primaryKey(),
  lastNumber: integer("last_number").notNull(),
});

export type CustomerCodeCounter = typeof customerCodeCounter.$inferSelect;
