import { desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { FollowUpListItem } from "./types";

const LIST_LIMIT = 500;

function mapRow(row: {
  id: string;
  customerId: string;
  customerName: string;
  userId: string;
  userName: string;
  followUpTime: string;
  channel: string;
  outcome: string;
  summary: string;
  nextFollowUpAt: string | null;
  nextAction: string | null;
  customerSalesStage: string;
  customerStatus: string;
  isValidFollowUp: number;
}): FollowUpListItem {
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
    nextFollowUpAt: row.nextFollowUpAt,
    nextAction: row.nextAction,
    customerSalesStage: row.customerSalesStage,
    customerStatus: row.customerStatus,
    isValidFollowUp: row.isValidFollowUp === 1,
  };
}

const listSelect = {
  id: schema.followUps.id,
  customerId: schema.followUps.customerId,
  customerName: schema.customers.customerName,
  userId: schema.followUps.userId,
  userName: schema.users.displayName,
  followUpTime: schema.followUps.followUpTime,
  channel: schema.followUps.channel,
  outcome: schema.followUps.outcome,
  summary: schema.followUps.summary,
  nextFollowUpAt: schema.followUps.nextFollowUpAt,
  nextAction: schema.followUps.nextAction,
  customerSalesStage: schema.customers.salesStage,
  customerStatus: schema.customers.status,
  isValidFollowUp: schema.followUps.isValidFollowUp,
};

export async function listFollowUpsForAdmin(
  db: Database,
  limit = LIST_LIMIT,
): Promise<FollowUpListItem[]> {
  const rows = await db
    .select(listSelect)
    .from(schema.followUps)
    .innerJoin(
      schema.customers,
      eq(schema.followUps.customerId, schema.customers.id),
    )
    .innerJoin(schema.users, eq(schema.followUps.userId, schema.users.id))
    .orderBy(desc(schema.followUps.followUpTime))
    .limit(limit);

  return rows.map(mapRow);
}

export async function listFollowUpsForStaff(
  db: Database,
  userId: string,
  limit = LIST_LIMIT,
): Promise<FollowUpListItem[]> {
  const rows = await db
    .select(listSelect)
    .from(schema.followUps)
    .innerJoin(
      schema.customers,
      eq(schema.followUps.customerId, schema.customers.id),
    )
    .innerJoin(schema.users, eq(schema.followUps.userId, schema.users.id))
    .where(eq(schema.followUps.userId, userId))
    .orderBy(desc(schema.followUps.followUpTime))
    .limit(limit);

  return rows.map(mapRow);
}
