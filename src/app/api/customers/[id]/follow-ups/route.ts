export const dynamic = "force-dynamic";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import {
  assertCanAddFollowUp,
  assertCanViewFollowUps,
  PermissionError,
} from "@/lib/permissions/customers";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { validateFollowUpInput } from "@/lib/follow-ups/validation";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { isValidFollowUpOutcome } from "@/lib/constants/follow-up-outcomes";
import type { FollowUpOutcome } from "@/lib/constants/follow-up-outcomes";
import { upsertFollowUpTask } from "@/lib/tasks/service";
import { getRequestMeta } from "@/lib/auth/cookies";
import {
  FOLLOW_UP_CHANNEL_LABELS,
  type FollowUpChannel,
} from "@/lib/constants/follow-up-channels";
import {
  FOLLOW_UP_OUTCOME_LABELS,
} from "@/lib/constants/follow-up-outcomes";

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
      return Response.json({ error: "客户不存在" }, { status: 404 });
    }

    try {
      assertCanViewFollowUps(user, customer);
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
    const { ipAddress, userAgent } = getRequestMeta(request);

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json({ error: "客户不存在" }, { status: 404 });
    }

    try {
      assertCanAddFollowUp(user, customer);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: "follow_up.create_failed.permission_denied",
          userId: user.id,
          entityType: "customer",
          entityId: id,
          metadata: { reason: err.message },
        });
      }
      throw err;
    }

    const body = (await request.json()) as Record<string, unknown>;
    const input = {
      followUpTime:
        typeof body.followUpTime === "string" ? body.followUpTime : undefined,
      channel: typeof body.channel === "string" ? body.channel : "",
      outcome: typeof body.outcome === "string" ? body.outcome : "",
      summary: typeof body.summary === "string" ? body.summary : "",
      customerIntent:
        typeof body.customerIntent === "string" ? body.customerIntent : null,
      nextFollowUpAt:
        typeof body.nextFollowUpAt === "string" ? body.nextFollowUpAt : null,
      nextAction: typeof body.nextAction === "string" ? body.nextAction : null,
    };

    const fieldErrors = validateFollowUpInput(input);
    if (fieldErrors.length > 0) {
      await writeAuditLog({
        userId: user.id,
        action: "follow_up.create_failed.validation",
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
        metadata: { fieldErrors },
      });
      return Response.json(
        { error: "输入校验失败", fieldErrors },
        { status: 400 },
      );
    }

    const followUpTime = input.followUpTime?.trim() || new Date().toISOString();
    const outcome = input.outcome as FollowUpOutcome;
    const isValid = isValidFollowUpOutcome(outcome) ? 1 : 0;
    const nextFollowUpAt = input.nextFollowUpAt?.trim() || null;
    const now = new Date().toISOString();
    const followUpId = crypto.randomUUID();
    const db = getDb();

    await db.insert(schema.followUps).values({
      id: followUpId,
      customerId: id,
      userId: user.id,
      followUpTime,
      channel: input.channel,
      outcome: input.outcome,
      summary: input.summary.trim(),
      customerIntent: input.customerIntent?.trim() || null,
      nextFollowUpAt,
      nextAction: input.nextAction?.trim() || null,
      isValidFollowUp: isValid,
      content: input.summary.trim(),
      createdAt: now,
    });

    const customerUpdates: Record<string, string | null> = {
      lastFollowUpAt: followUpTime,
      updatedAt: now,
      updatedBy: user.id,
    };

    if (isValid === 1) {
      customerUpdates.lastValidFollowUpAt = followUpTime;
    }

    if (nextFollowUpAt) {
      customerUpdates.nextFollowUpAt = nextFollowUpAt;
    }

    await db
      .update(schema.customers)
      .set(customerUpdates)
      .where(eq(schema.customers.id, id));

    let taskId: string | null = null;
    if (nextFollowUpAt) {
      const taskResult = await upsertFollowUpTask(
        { ...customer, nextFollowUpAt },
        nextFollowUpAt,
        user.id,
        { ipAddress, userAgent },
      );
      taskId = taskResult.taskId;
    }

    await writeAuditLog({
      userId: user.id,
      action: "follow_up.created",
      entityType: "follow_up",
      entityId: followUpId,
      ipAddress,
      userAgent,
      metadata: {
        customerId: id,
        outcome: input.outcome,
        isValidFollowUp: isValid === 1,
        taskId,
      },
    });

    return Response.json(
      {
        ok: true,
        id: followUpId,
        isValidFollowUp: isValid === 1,
        taskId,
      },
      { status: 201 },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
