import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getDaysWithoutValidFollowUp } from "@/lib/reclamation/days";
import { RECLAMATION_EXCLUDED_SALES_STAGES } from "@/lib/reclamation/constants";

const MS_PER_HOUR = 60 * 60 * 1000;
export const RECLAIM_RULE_SHORTENING_GRACE_HOURS = 24;

/**
 * When Admin shortens automatic_reclaim_days, customers already over the new
 * threshold enter a 24h grace window before auto-reclaim may run.
 */
export async function applyReclaimRuleShorteningGrace(
  db: Database,
  input: {
    previousReclaimDays: number;
    newReclaimDays: number;
    now: Date;
    actorUserId: string;
  },
): Promise<{ graceAppliedCount: number }> {
  const { previousReclaimDays, newReclaimDays, now, actorUserId } = input;
  if (newReclaimDays >= previousReclaimDays) {
    return { graceAppliedCount: 0 };
  }

  const graceUntil = new Date(
    now.getTime() + RECLAIM_RULE_SHORTENING_GRACE_HOURS * MS_PER_HOUR,
  ).toISOString();

  const rows = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "active"),
        isNotNull(schema.customers.ownerId),
        eq(schema.customers.isPinned, 0),
        notInArray(
          schema.customers.salesStage,
          [...RECLAMATION_EXCLUDED_SALES_STAGES],
        ),
      ),
    );

  let graceAppliedCount = 0;
  for (const customer of rows) {
    const idleDays = getDaysWithoutValidFollowUp(customer, now);
    if (idleDays < newReclaimDays) {
      continue;
    }

    if (
      customer.reclaimRuleGraceUntil &&
      new Date(customer.reclaimRuleGraceUntil).getTime() > now.getTime()
    ) {
      continue;
    }

    await db
      .update(schema.customers)
      .set({
        reclaimRuleGraceUntil: graceUntil,
        updatedAt: now.toISOString(),
      })
      .where(eq(schema.customers.id, customer.id));

    graceAppliedCount += 1;

    await writeAuditLog(
      {
        userId: actorUserId,
        action: "customer.reclaim_rule_grace_started",
        entityType: "customer",
        entityId: customer.id,
        metadata: {
          previousReclaimDays,
          newReclaimDays,
          graceUntil,
          idleDays,
          executedBy: "system",
        },
      },
      db,
    );
  }

  return { graceAppliedCount };
}

/** Admin increased reclaim period — clear pending grace; no new protection. */
export async function clearReclaimRuleGraceForAll(
  db: Database,
  now: Date,
): Promise<number> {
  const isoNow = now.toISOString();
  const rows = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(isNotNull(schema.customers.reclaimRuleGraceUntil));

  if (rows.length === 0) return 0;

  for (const row of rows) {
    await db
      .update(schema.customers)
      .set({
        reclaimRuleGraceUntil: null,
        updatedAt: isoNow,
      })
      .where(eq(schema.customers.id, row.id));
  }

  return rows.length;
}
