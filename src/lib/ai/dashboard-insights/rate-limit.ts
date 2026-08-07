import { and, eq } from "drizzle-orm";
import * as schema from "../../../../drizzle/schema";
import { getHongKongUsageDate } from "@/lib/ai/staff-usage/service";
import type { Database } from "@/lib/db";
import { DASHBOARD_AI_RATE_LIMIT_WINDOW_MS } from "./constants";
import type { DashboardAiInsightType } from "./types";

export type DashboardAiRateLimitResult =
  | { allowed: true; eventId: string }
  | { allowed: false; retryAfterMs: number };

function buildReservationKey(
  userId: string,
  insightType: DashboardAiInsightType,
  windowBucket: number,
): string {
  return `dashboard-ai:${userId}:${insightType}:${windowBucket}`;
}

function retryAfterMsForWindow(nowMs: number, windowBucket: number): number {
  const nextWindowMs = (windowBucket + 1) * DASHBOARD_AI_RATE_LIMIT_WINDOW_MS;
  return Math.max(0, nextWindowMs - nowMs);
}

/**
 * Shared D1-backed force-refresh limiter (60s per user + insight type).
 * Reuses `ai_usage_events` with operation type `dashboard_ai_insight`.
 */
export async function reserveDashboardAiProviderRefresh(
  db: Database,
  input: {
    userId: string;
    insightType: DashboardAiInsightType;
    now?: Date;
  },
): Promise<DashboardAiRateLimitResult> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const windowBucket = Math.floor(nowMs / DASHBOARD_AI_RATE_LIMIT_WINDOW_MS);
  const reservationKey = buildReservationKey(
    input.userId,
    input.insightType,
    windowBucket,
  );
  const nowIso = now.toISOString();
  const usageDate = getHongKongUsageDate(now);
  const eventId = crypto.randomUUID();

  const existing = await db
    .select({ id: schema.aiUsageEvents.id })
    .from(schema.aiUsageEvents)
    .where(eq(schema.aiUsageEvents.reservationKey, reservationKey))
    .limit(1);

  if (existing[0]) {
    return {
      allowed: false,
      retryAfterMs: retryAfterMsForWindow(nowMs, windowBucket),
    };
  }

  try {
    await db.insert(schema.aiUsageEvents).values({
      id: eventId,
      userId: input.userId,
      usageDate,
      operationType: "dashboard_ai_insight",
      status: "pending",
      reservationKey,
      customerId: null,
      provider: null,
      createdAt: nowIso,
      completedAt: null,
    });
    return { allowed: true, eventId };
  } catch {
    return {
      allowed: false,
      retryAfterMs: retryAfterMsForWindow(nowMs, windowBucket),
    };
  }
}

export async function completeDashboardAiProviderRefresh(
  db: Database,
  eventId: string,
  status: "succeeded" | "failed",
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(schema.aiUsageEvents)
    .set({
      status,
      completedAt: now.toISOString(),
    })
    .where(eq(schema.aiUsageEvents.id, eventId));
}

export async function clearDashboardAiRateLimitEventsForTests(
  db: Database,
  userId: string,
): Promise<void> {
  await db
    .delete(schema.aiUsageEvents)
    .where(
      and(
        eq(schema.aiUsageEvents.userId, userId),
        eq(schema.aiUsageEvents.operationType, "dashboard_ai_insight"),
      ),
    );
}
