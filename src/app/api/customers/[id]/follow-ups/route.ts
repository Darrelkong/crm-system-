export const dynamic = "force-dynamic";

import { getDb, schema } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { assertCanViewFollowUps, PermissionError, resolveCustomerAccessOptions } from "@/lib/permissions/customers";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { blockPendingOnHoldCreateCustomer } from "@/lib/customers/pending-on-hold-api";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { createCustomerFollowUp } from "@/lib/follow-ups/create-service";
import { FOLLOW_UP_CHANNEL_LABELS, type FollowUpChannel } from "@/lib/constants/follow-up-channels";
import { FOLLOW_UP_OUTCOME_LABELS, type FollowUpOutcome } from "@/lib/constants/follow-up-outcomes";

type RouteContext = { params: Promise<{ id: string }> };

function formatFollowUpRow(row: typeof schema.followUps.$inferSelect) {
  return {
    id: row.id,
    customerId: row.customerId,
    userId: row.userId,
    followUpTime: row.followUpTime,
    channel: row.channel,
    channelLabel:
      FOLLOW_UP_CHANNEL_LABELS[row.channel as FollowUpChannel] ?? row.channel,
    outcome: row.outcome,
    outcomeLabel:
      FOLLOW_UP_OUTCOME_LABELS[row.outcome as FollowUpOutcome] ?? row.outcome,
    summary: row.summary,
    customerIntent: row.customerIntent,
    nextFollowUpAt: row.nextFollowUpAt,
    nextAction: row.nextAction,
    isValidFollowUp: row.isValidFollowUp === 1,
    createdAt: row.createdAt,
  };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json({ error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    }

    const db = getDb();
    const pendingBlock = await blockPendingOnHoldCreateCustomer(db, id);
    if (pendingBlock) {
      return pendingBlock;
    }

    const accessOptions = await resolveCustomerAccessOptions(db, user, id);

    try {
      assertCanViewFollowUps(user, customer, accessOptions);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: err.auditAction ?? "permission.denied.follow_up_access",
          userId: user.id,
          entityType: "customer",
          entityId: id,
        });
      }
      throw err;
    }

    const rows = await listFollowUpsByCustomerId(id);
    return Response.json({
      items: rows.map(formatFollowUpRow),
      total: rows.length,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    return await createCustomerFollowUp(request, id, user);
  } catch (error) {
    return authErrorResponse(error);
  }
}
