import { desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { RecentFollowUpRow } from "./types";

const RECENT_FOLLOW_UP_LIMIT = 10;

function mapRecentFollowUpRow(
  row: {
    id: string;
    customerId: string;
    customerName: string;
    userId: string;
    userName: string;
    followUpTime: string;
    channel: string;
    outcome: string;
    summary: string;
    isValidFollowUp: number;
  },
): RecentFollowUpRow {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customerName,
    userId: row.userId,
    userName: row.userName,
    followUpTime: row.followUpTime,
    channel: row.channel,
    outcome: row.outcome,
    summary: row.summary,
    isValidFollowUp: row.isValidFollowUp === 1,
  };
}

export async function listRecentFollowUpsForAdmin(
  db: Database,
  limit = RECENT_FOLLOW_UP_LIMIT,
): Promise<RecentFollowUpRow[]> {
  const rows = await db
    .select({
      id: schema.followUps.id,
      customerId: schema.followUps.customerId,
      customerName: schema.customers.customerName,
      userId: schema.followUps.userId,
      userName: schema.users.displayName,
      followUpTime: schema.followUps.followUpTime,
      channel: schema.followUps.channel,
      outcome: schema.followUps.outcome,
      summary: schema.followUps.summary,
      isValidFollowUp: schema.followUps.isValidFollowUp,
    })
    .from(schema.followUps)
    .innerJoin(
      schema.customers,
      eq(schema.followUps.customerId, schema.customers.id),
    )
    .innerJoin(schema.users, eq(schema.followUps.userId, schema.users.id))
    .orderBy(desc(schema.followUps.followUpTime))
    .limit(limit);

  return rows.map(mapRecentFollowUpRow);
}

export async function listRecentFollowUpsForStaff(
  db: Database,
  userId: string,
  limit = RECENT_FOLLOW_UP_LIMIT,
): Promise<RecentFollowUpRow[]> {
  const rows = await db
    .select({
      id: schema.followUps.id,
      customerId: schema.followUps.customerId,
      customerName: schema.customers.customerName,
      userId: schema.followUps.userId,
      userName: schema.users.displayName,
      followUpTime: schema.followUps.followUpTime,
      channel: schema.followUps.channel,
      outcome: schema.followUps.outcome,
      summary: schema.followUps.summary,
      isValidFollowUp: schema.followUps.isValidFollowUp,
    })
    .from(schema.followUps)
    .innerJoin(
      schema.customers,
      eq(schema.followUps.customerId, schema.customers.id),
    )
    .innerJoin(schema.users, eq(schema.followUps.userId, schema.users.id))
    .where(eq(schema.followUps.userId, userId))
    .orderBy(desc(schema.followUps.followUpTime))
    .limit(limit);

  return rows.map(mapRecentFollowUpRow);
}
