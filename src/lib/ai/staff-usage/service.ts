import { and, eq, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { formatHongKongDate } from "@/lib/timezone";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import type { User } from "../../../../drizzle/schema/users";
import type { AiProviderKind } from "@/lib/settings/ai-keys";

/** Pending reservations older than this no longer consume quota. */
export const STAFF_AI_PENDING_TTL_MS = 15 * 60 * 1000;

/** Cap lazy expiry work per request (scoped by user + date + status). */
export const STAFF_AI_PENDING_EXPIRE_LIMIT = 50;

export const STAFF_AI_ADMIN_STAFF_LIST_LIMIT = 200;

export type StaffAiUsageDenialReason =
  | "global_disabled"
  | "staff_deep_analysis_disabled"
  | "daily_limit_reached"
  | "provider_mock";

export type StaffAiUsageSummary = {
  usageDate: string;
  enabled: boolean;
  dailyLimit: number;
  used: number;
  remaining: number;
  denialReason: StaffAiUsageDenialReason | null;
};

export type StaffAiReservationStatus = "pending" | "succeeded";

export type StaffAiReservation = {
  eventId: string;
  reservationKey: string;
  usageDate: string;
  reused: boolean;
  status: StaffAiReservationStatus;
};

export class StaffAiQuotaError extends Error {
  readonly code:
    | "AI_STAFF_DEEP_ANALYSIS_DISABLED"
    | "AI_STAFF_DAILY_LIMIT_REACHED"
    | "AI_STAFF_RESERVATION_CONFLICT";

  constructor(
    code:
      | "AI_STAFF_DEEP_ANALYSIS_DISABLED"
      | "AI_STAFF_DAILY_LIMIT_REACHED"
      | "AI_STAFF_RESERVATION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "StaffAiQuotaError";
    this.code = code;
  }
}

export function getHongKongUsageDate(now: Date = new Date()): string {
  return formatHongKongDate(now, "");
}

export function isExternalAiProviderKind(kind: AiProviderKind): boolean {
  return kind === "openai_compatible" || kind === "google_gemini";
}

function pendingCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - STAFF_AI_PENDING_TTL_MS).toISOString();
}

export function computeRemaining(used: number, dailyLimit: number): number {
  return Math.max(0, dailyLimit - Math.max(0, used));
}

export async function getStaffSucceededUsageCount(
  db: Database,
  userId: string,
  usageDate: string,
): Promise<number> {
  const [row] = await db
    .select({
      succeededCount: schema.aiStaffDailyQuota.succeededCount,
    })
    .from(schema.aiStaffDailyQuota)
    .where(
      and(
        eq(schema.aiStaffDailyQuota.userId, userId),
        eq(schema.aiStaffDailyQuota.usageDate, usageDate),
      ),
    )
    .limit(1);

  return row?.succeededCount ?? 0;
}

async function getStaffReservedUsageCount(
  db: Database,
  userId: string,
  usageDate: string,
): Promise<number> {
  const [row] = await db
    .select({
      reservedCount: schema.aiStaffDailyQuota.reservedCount,
    })
    .from(schema.aiStaffDailyQuota)
    .where(
      and(
        eq(schema.aiStaffDailyQuota.userId, userId),
        eq(schema.aiStaffDailyQuota.usageDate, usageDate),
      ),
    )
    .limit(1);

  return row?.reservedCount ?? 0;
}

/**
 * Expire stale pending events for one staff + HK day and release reserved slots.
 * Only decrements for rows actually flipped pending → expired (concurrent-safe).
 */
export async function expireStalePendingForUser(
  db: Database,
  userId: string,
  usageDate: string,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = pendingCutoffIso(now);
  const nowIso = now.toISOString();

  const stale = await db
    .select({ id: schema.aiUsageEvents.id })
    .from(schema.aiUsageEvents)
    .where(
      and(
        eq(schema.aiUsageEvents.userId, userId),
        eq(schema.aiUsageEvents.usageDate, usageDate),
        eq(schema.aiUsageEvents.status, "pending"),
        lt(schema.aiUsageEvents.createdAt, cutoff),
      ),
    )
    .limit(STAFF_AI_PENDING_EXPIRE_LIMIT);

  if (stale.length === 0) return 0;

  let released = 0;
  for (const row of stale) {
    const updated = await db
      .update(schema.aiUsageEvents)
      .set({ status: "expired", completedAt: nowIso })
      .where(
        and(
          eq(schema.aiUsageEvents.id, row.id),
          eq(schema.aiUsageEvents.status, "pending"),
        ),
      )
      .returning({ id: schema.aiUsageEvents.id });
    if (updated.length > 0) {
      released += 1;
    }
  }

  if (released === 0) return 0;

  await db
    .update(schema.aiStaffDailyQuota)
    .set({
      reservedCount: sql`max(0, ${schema.aiStaffDailyQuota.reservedCount} - ${released})`,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.aiStaffDailyQuota.userId, userId),
        eq(schema.aiStaffDailyQuota.usageDate, usageDate),
      ),
    );

  return released;
}

export async function getStaffAiUsageSummary(
  db: Database,
  user: User,
  settings: EffectiveAiSettings,
  now: Date = new Date(),
): Promise<StaffAiUsageSummary> {
  const usageDate = getHongKongUsageDate(now);
  const dailyLimit = settings.aiStaffDailyLimit;

  if (user.role === "admin") {
    return {
      usageDate,
      enabled: true,
      dailyLimit,
      used: 0,
      remaining: dailyLimit,
      denialReason: null,
    };
  }

  if (!settings.aiEnabled) {
    return {
      usageDate,
      enabled: false,
      dailyLimit,
      used: 0,
      remaining: 0,
      denialReason: "global_disabled",
    };
  }

  if (!settings.aiStaffDeepAnalysisEnabled) {
    await expireStalePendingForUser(db, user.id, usageDate, now);
    return {
      usageDate,
      enabled: false,
      dailyLimit,
      used: await getStaffSucceededUsageCount(db, user.id, usageDate),
      remaining: 0,
      denialReason: "staff_deep_analysis_disabled",
    };
  }

  await expireStalePendingForUser(db, user.id, usageDate, now);
  const used = await getStaffSucceededUsageCount(db, user.id, usageDate);
  const reserved = await getStaffReservedUsageCount(db, user.id, usageDate);
  // Remaining capacity accounts for in-flight pending (reserved), not only succeeded.
  const remaining = computeRemaining(reserved, dailyLimit);

  return {
    usageDate,
    enabled: true,
    dailyLimit,
    used,
    remaining,
    denialReason: remaining <= 0 ? "daily_limit_reached" : null,
  };
}

async function tryIncrementReserved(
  db: Database,
  userId: string,
  usageDate: string,
  limit: number,
  nowIso: string,
): Promise<boolean> {
  const updated = await db
    .update(schema.aiStaffDailyQuota)
    .set({
      reservedCount: sql`${schema.aiStaffDailyQuota.reservedCount} + 1`,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.aiStaffDailyQuota.userId, userId),
        eq(schema.aiStaffDailyQuota.usageDate, usageDate),
        lt(schema.aiStaffDailyQuota.reservedCount, limit),
      ),
    )
    .returning({
      reservedCount: schema.aiStaffDailyQuota.reservedCount,
    });

  if (updated.length > 0) {
    return true;
  }

  try {
    await db.insert(schema.aiStaffDailyQuota).values({
      userId,
      usageDate,
      reservedCount: 1,
      succeededCount: 0,
      updatedAt: nowIso,
    });
    return true;
  } catch {
    const retried = await db
      .update(schema.aiStaffDailyQuota)
      .set({
        reservedCount: sql`${schema.aiStaffDailyQuota.reservedCount} + 1`,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(schema.aiStaffDailyQuota.userId, userId),
          eq(schema.aiStaffDailyQuota.usageDate, usageDate),
          lt(schema.aiStaffDailyQuota.reservedCount, limit),
        ),
      )
      .returning({
        reservedCount: schema.aiStaffDailyQuota.reservedCount,
      });
    return retried.length > 0;
  }
}

/**
 * Reserve one staff external-AI slot after permission checks.
 * Admin callers must not invoke this (they are exempt).
 */
export async function reserveStaffAiUsage(
  db: Database,
  input: {
    user: User;
    settings: EffectiveAiSettings;
    reservationKey: string;
    customerId: string;
    providerKind: AiProviderKind;
    now?: Date;
  },
): Promise<StaffAiReservation> {
  const { user, settings, reservationKey, customerId, providerKind } = input;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const usageDate = getHongKongUsageDate(now);

  if (user.role !== "staff") {
    throw new Error("reserveStaffAiUsage is only for staff");
  }

  if (!settings.aiEnabled || !isExternalAiProviderKind(providerKind)) {
    throw new StaffAiQuotaError(
      "AI_STAFF_DEEP_ANALYSIS_DISABLED",
      "外部 AI 深度分析目前不可用",
    );
  }

  if (!settings.aiStaffDeepAnalysisEnabled) {
    throw new StaffAiQuotaError(
      "AI_STAFF_DEEP_ANALYSIS_DISABLED",
      "管理员目前未开放员工 AI 深度分析",
    );
  }

  const existing = await db
    .select()
    .from(schema.aiUsageEvents)
    .where(eq(schema.aiUsageEvents.reservationKey, reservationKey))
    .limit(1);

  if (existing[0]) {
    const row = existing[0];
    if (row.userId !== user.id) {
      throw new StaffAiQuotaError(
        "AI_STAFF_RESERVATION_CONFLICT",
        "无效的用量保留键",
      );
    }
    if (row.status === "succeeded") {
      return {
        eventId: row.id,
        reservationKey: row.reservationKey,
        usageDate: row.usageDate,
        reused: true,
        status: "succeeded",
      };
    }
    if (row.status === "pending") {
      return {
        eventId: row.id,
        reservationKey: row.reservationKey,
        usageDate: row.usageDate,
        reused: true,
        status: "pending",
      };
    }
    // failed / expired: caller must use a new key for a new analysis attempt
    throw new StaffAiQuotaError(
      "AI_STAFF_RESERVATION_CONFLICT",
      "此用量保留键已结束，请重新发起分析",
    );
  }

  await expireStalePendingForUser(db, user.id, usageDate, now);

  const reserved = await tryIncrementReserved(
    db,
    user.id,
    usageDate,
    settings.aiStaffDailyLimit,
    nowIso,
  );

  if (!reserved) {
    throw new StaffAiQuotaError(
      "AI_STAFF_DAILY_LIMIT_REACHED",
      "今日 AI 深度分析次数已用完",
    );
  }

  const eventId = crypto.randomUUID();
  try {
    await db.insert(schema.aiUsageEvents).values({
      id: eventId,
      userId: user.id,
      usageDate,
      operationType: "deep_analysis_refresh",
      status: "pending",
      reservationKey,
      customerId,
      provider: providerKind,
      createdAt: nowIso,
      completedAt: null,
    });
  } catch {
    await db
      .update(schema.aiStaffDailyQuota)
      .set({
        reservedCount: sql`max(0, ${schema.aiStaffDailyQuota.reservedCount} - 1)`,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(schema.aiStaffDailyQuota.userId, user.id),
          eq(schema.aiStaffDailyQuota.usageDate, usageDate),
        ),
      );

    const again = await db
      .select()
      .from(schema.aiUsageEvents)
      .where(eq(schema.aiUsageEvents.reservationKey, reservationKey))
      .limit(1);

    if (again[0] && again[0].userId === user.id) {
      if (again[0].status === "succeeded" || again[0].status === "pending") {
        return {
          eventId: again[0].id,
          reservationKey: again[0].reservationKey,
          usageDate: again[0].usageDate,
          reused: true,
          status: again[0].status as StaffAiReservationStatus,
        };
      }
      throw new StaffAiQuotaError(
        "AI_STAFF_RESERVATION_CONFLICT",
        "此用量保留键已结束，请重新发起分析",
      );
    }

    throw new StaffAiQuotaError(
      "AI_STAFF_DAILY_LIMIT_REACHED",
      "今日 AI 深度分析次数已用完",
    );
  }

  return {
    eventId,
    reservationKey,
    usageDate,
    reused: false,
    status: "pending",
  };
}

export async function completeStaffAiUsage(
  db: Database,
  reservation: StaffAiReservation & { userId: string },
  now: Date = new Date(),
): Promise<void> {
  if (reservation.reused && reservation.status === "succeeded") {
    return;
  }

  const nowIso = now.toISOString();
  const updated = await db
    .update(schema.aiUsageEvents)
    .set({ status: "succeeded", completedAt: nowIso })
    .where(
      and(
        eq(schema.aiUsageEvents.id, reservation.eventId),
        eq(schema.aiUsageEvents.status, "pending"),
      ),
    )
    .returning({ id: schema.aiUsageEvents.id });

  if (updated.length === 0) {
    return;
  }

  await db
    .update(schema.aiStaffDailyQuota)
    .set({
      succeededCount: sql`${schema.aiStaffDailyQuota.succeededCount} + 1`,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.aiStaffDailyQuota.userId, reservation.userId),
        eq(schema.aiStaffDailyQuota.usageDate, reservation.usageDate),
      ),
    );
}

export async function failStaffAiUsage(
  db: Database,
  reservation: StaffAiReservation & { userId: string },
  now: Date = new Date(),
): Promise<void> {
  if (reservation.reused && reservation.status === "succeeded") {
    return;
  }

  const nowIso = now.toISOString();
  const updated = await db
    .update(schema.aiUsageEvents)
    .set({ status: "failed", completedAt: nowIso })
    .where(
      and(
        eq(schema.aiUsageEvents.id, reservation.eventId),
        eq(schema.aiUsageEvents.status, "pending"),
      ),
    )
    .returning({ id: schema.aiUsageEvents.id });

  if (updated.length === 0) {
    return;
  }

  await db
    .update(schema.aiStaffDailyQuota)
    .set({
      reservedCount: sql`max(0, ${schema.aiStaffDailyQuota.reservedCount} - 1)`,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.aiStaffDailyQuota.userId, reservation.userId),
        eq(schema.aiStaffDailyQuota.usageDate, reservation.usageDate),
      ),
    );
}

export type StaffAiReservationResult = StaffAiReservation & { userId: string };

export async function reserveStaffAiUsageForRefresh(
  db: Database,
  input: {
    user: User;
    settings: EffectiveAiSettings;
    reservationKey: string;
    customerId: string;
    providerKind: AiProviderKind;
    now?: Date;
  },
): Promise<StaffAiReservationResult> {
  const reservation = await reserveStaffAiUsage(db, input);
  return { ...reservation, userId: input.user.id };
}
