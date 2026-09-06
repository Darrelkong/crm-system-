export const dynamic = "force-dynamic";

import { and, eq } from "drizzle-orm";
import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";
import { getDb, schema } from "@/lib/db";
import {
  getPublicPoolMemberPolicy,
  validatePublicPoolPolicyOverride,
} from "@/lib/public-pool/member-policy";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdmin(request);
    const { id } = await context.params;
    const db = getDb();
    const body = (await request.json()) as Record<string, unknown>;
    const hasPause = "poolClaimPaused" in body;
    const hasQuota = "quotaOverride" in body;
    const hasCooldown = "cooldownHoursOverride" in body;

    if (!hasPause && !hasQuota && !hasCooldown) {
      return Response.json(
        { error: "没有可更新的领取权限字段", errorCode: "INVALID_POLICY" },
        { status: 400 },
      );
    }

    const user = (
      await db
        .select({ id: schema.users.id, role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .limit(1)
    )[0];
    if (!user || user.role !== "staff") {
      return Response.json(
        { error: "员工不存在", errorCode: "STAFF_NOT_FOUND" },
        { status: 404 },
      );
    }

    const parsed = validatePublicPoolPolicyOverride(
      hasQuota ? body.quotaOverride : undefined,
      hasCooldown ? body.cooldownHoursOverride : undefined,
    );
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.message, errorCode: "INVALID_POLICY" },
        { status: 400 },
      );
    }
    if (
      hasPause &&
      typeof body.poolClaimPaused !== "boolean"
    ) {
      return Response.json(
        { error: "领取状态无效", errorCode: "INVALID_POLICY" },
        { status: 400 },
      );
    }

    const current = (
      await db
        .select({
          poolClaimPaused: schema.users.poolClaimPaused,
          quotaOverride: schema.users.poolClaimQuotaOverride,
          cooldownHoursOverride: schema.users.poolClaimCooldownHoursOverride,
        })
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .limit(1)
    )[0]!;
    const now = new Date().toISOString();

    await db
      .update(schema.users)
      .set({
        poolClaimPaused: hasPause
          ? body.poolClaimPaused
            ? 1
            : 0
          : current.poolClaimPaused,
        poolClaimQuotaOverride: hasQuota
          ? parsed.quotaOverride
          : current.quotaOverride,
        poolClaimCooldownHoursOverride: hasCooldown
          ? parsed.cooldownHoursOverride
          : current.cooldownHoursOverride,
        updatedAt: now,
      })
      .where(and(eq(schema.users.id, id), eq(schema.users.role, "staff")));

    return Response.json({
      ok: true,
      policy: await getPublicPoolMemberPolicy(db, id),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
