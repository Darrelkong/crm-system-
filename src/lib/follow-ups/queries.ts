import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export async function listFollowUpsByCustomerId(customerId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.followUps)
    .where(eq(schema.followUps.customerId, customerId))
    .orderBy(desc(schema.followUps.followUpTime));
}
