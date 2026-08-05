export const dynamic = "force-dynamic";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import {
  assertCanAddFollowUp,
  assertCanViewFollowUps,
  PermissionError,
  resolveCustomerAccessOptions,
} from "@/lib/permissions/customers";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { blockPendingOnHoldCreateCustomer } from "@/lib/customers/pending-on-hold-api";
import { writeAuditLog } from "@/lib/audit/audit-log";
import {
  normalizeNextFollowUpAt,
  validateFollowUpInput,
} from "@/lib/follow-ups/validation";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import {
  evaluateDuplicateFollowUpContent,
} from "@/lib/follow-ups/duplicate-content";
import {
  buildReclamationCycleResetFields,
  getReclamationCycleStartedAt,
} from "@/lib/reclamation/cycle";
import { completeReclamationActionItemsForFollowUp } from "@/lib/reclamation/work-items-sync";
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
    const { ipAddress, userAgent } = getRequestMeta(request);

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
      assertCanAddFollowUp(user, customer, accessOptions);
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
        { error: "输入校验失败", errorCode: "VALIDATION_FAILED", fieldErrors },
        { status: 400 },
      );
    }

    const confirmDuplicateFollowUp =
      body.confirmDuplicateFollowUp === true ||
      body.confirmDuplicateFollowUp === "true";

    const existingFollowUps = await listFollowUpsByCustomerId(id);
    const latestByUser = existingFollowUps.find((row) => row.userId === user.id);
    const duplicateCheck = evaluateDuplicateFollowUpContent({
      newSummary: input.summary,
      previousSummary: latestByUser?.summary ?? null,
      previousFollowUpTime: latestByUser?.followUpTime ?? null,
      now: new Date(),
      confirmed: confirmDuplicateFollowUp,
    });
    if (duplicateCheck.kind === "duplicate_requires_confirm") {
      return Response.json(
        {
          error:
            "本次跟进内容与最近一次记录相同，请确认是否继续提交。",
          errorCode: "FOLLOW_UP_DUPLICATE_CONTENT",
          requiresConfirm: true,
        },
        { status: 409 },
      );
    }

    const followUpTime = input.followUpTime?.trim() || new Date().toISOString();
    const outcome = input.outcome as FollowUpOutcome;
    const isValid = isValidFollowUpOutcome(outcome) ? 1 : 0;
    const nextFollowUpAt = normalizeNextFollowUpAt(input.nextFollowUpAt);
    const now = new Date().toISOString();
    const followUpId = crypto.randomUUID();

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
      nextAction: input.nextAction!.trim(),
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
      if (customer.ownerId && customer.ownerId === user.id) {
        await completeReclamationActionItemsForFollowUp(db, {
          customerId: id,
          ownerId: customer.ownerId,
          cycleStartedAt: getReclamationCycleStartedAt(customer),
          followUpId,
        });
      }
      customerUpdates.lastValidFollowUpAt = followUpTime;
      Object.assign(
        customerUpdates,
        buildReclamationCycleResetFields(followUpTime),
      );
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
        ...(confirmDuplicateFollowUp
          ? { duplicateContentConfirmed: true }
          : {}),
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
