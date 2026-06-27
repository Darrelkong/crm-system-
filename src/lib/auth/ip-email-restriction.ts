import { eq } from "drizzle-orm";
import { getRequestMeta } from "@/lib/auth/cookies";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { getDb, schema } from "@/lib/db";

export const IP_EMAIL_RESTRICTION_STATUS_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
} as const;

export const IP_EMAIL_ATTEMPT_THRESHOLD = 3;

export type IpEmailRestrictionState = {
  failedEmailAttempts: number;
  penaltyLevel: number;
  restrictedUntil: string | null;
};

export type IpEmailRestrictionCheck =
  | { restricted: false }
  | {
      restricted: true;
      restrictedUntil: string;
      remainingSeconds: number;
    };

export type UnauthorizedEmailAttemptResult =
  | { kind: "unauthorized" }
  | {
      kind: "restricted";
      restrictedUntil: string;
      remainingSeconds: number;
    };

export type IpEmailRestrictionStatusPayload =
  | { restricted: false }
  | {
      restricted: true;
      errorCode: typeof AUTH_ERROR_CODES.IP_EMAIL_RESTRICTED;
      remainingSeconds: number;
      restrictedUntil: string;
    };

export function getClientIpFromRequest(request: Request): string {
  const { ipAddress } = getRequestMeta(request);
  return ipAddress?.trim() || "unknown";
}

export function hasDisallowedIpEmailRestrictionStatusQuery(
  searchParams: URLSearchParams,
): boolean {
  return searchParams.toString().length > 0;
}

export function buildIpEmailRestrictionStatusPayload(
  check: IpEmailRestrictionCheck,
): IpEmailRestrictionStatusPayload {
  if (!check.restricted) {
    return { restricted: false };
  }

  return {
    restricted: true,
    errorCode: AUTH_ERROR_CODES.IP_EMAIL_RESTRICTED,
    remainingSeconds: check.remainingSeconds,
    restrictedUntil: check.restrictedUntil,
  };
}

export async function readIpEmailRestrictionStatus(
  ipAddress: string,
  nowMs = Date.now(),
): Promise<IpEmailRestrictionStatusPayload> {
  const state = await getIpEmailRestrictionForAddress(ipAddress);
  return buildIpEmailRestrictionStatusPayload(
    getActiveIpEmailRestriction(state, nowMs),
  );
}

export function getPenaltyDurationSeconds(penaltyLevel: number): number {
  if (penaltyLevel <= 1) {
    return 60;
  }
  if (penaltyLevel === 2) {
    return 120;
  }
  return 300;
}

export function getRemainingRestrictionSeconds(
  restrictedUntil: string,
  nowMs = Date.now(),
): number {
  return Math.max(
    0,
    Math.ceil((Date.parse(restrictedUntil) - nowMs) / 1000),
  );
}

export function getActiveIpEmailRestriction(
  state: IpEmailRestrictionState | null,
  nowMs = Date.now(),
): IpEmailRestrictionCheck {
  if (!state?.restrictedUntil) {
    return { restricted: false };
  }

  const remainingSeconds = getRemainingRestrictionSeconds(
    state.restrictedUntil,
    nowMs,
  );

  if (remainingSeconds <= 0) {
    return { restricted: false };
  }

  return {
    restricted: true,
    restrictedUntil: state.restrictedUntil,
    remainingSeconds,
  };
}

export function applyUnauthorizedEmailAttempt(
  state: IpEmailRestrictionState | null,
  nowMs = Date.now(),
): {
  state: IpEmailRestrictionState;
  result: UnauthorizedEmailAttemptResult;
} {
  const current: IpEmailRestrictionState = state ?? {
    failedEmailAttempts: 0,
    penaltyLevel: 0,
    restrictedUntil: null,
  };

  const attempts = current.failedEmailAttempts + 1;

  if (attempts < IP_EMAIL_ATTEMPT_THRESHOLD) {
    return {
      state: {
        ...current,
        failedEmailAttempts: attempts,
        restrictedUntil: null,
      },
      result: { kind: "unauthorized" },
    };
  }

  const penaltyLevel = current.penaltyLevel + 1;
  const remainingSeconds = getPenaltyDurationSeconds(penaltyLevel);
  const restrictedUntil = new Date(
    nowMs + remainingSeconds * 1000,
  ).toISOString();

  return {
    state: {
      failedEmailAttempts: 0,
      penaltyLevel,
      restrictedUntil,
    },
    result: {
      kind: "restricted",
      restrictedUntil,
      remainingSeconds,
    },
  };
}

function toState(
  row: typeof schema.loginIpEmailRestrictions.$inferSelect | undefined,
): IpEmailRestrictionState | null {
  if (!row) {
    return null;
  }
  return {
    failedEmailAttempts: row.failedEmailAttempts,
    penaltyLevel: row.penaltyLevel,
    restrictedUntil: row.restrictedUntil,
  };
}

export async function getIpEmailRestrictionForAddress(
  ipAddress: string,
): Promise<IpEmailRestrictionState | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.loginIpEmailRestrictions)
    .where(eq(schema.loginIpEmailRestrictions.ipAddress, ipAddress))
    .limit(1);
  return toState(rows[0]);
}

export async function checkIpEmailRestriction(
  ipAddress: string,
  nowMs = Date.now(),
): Promise<IpEmailRestrictionCheck> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.loginIpEmailRestrictions)
    .where(eq(schema.loginIpEmailRestrictions.ipAddress, ipAddress))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { restricted: false };
  }

  const active = getActiveIpEmailRestriction(toState(row), nowMs);
  if (!active.restricted && row.restrictedUntil) {
    const nowIso = new Date(nowMs).toISOString();
    await db
      .update(schema.loginIpEmailRestrictions)
      .set({
        restrictedUntil: null,
        updatedAt: nowIso,
      })
      .where(eq(schema.loginIpEmailRestrictions.ipAddress, ipAddress));
  }

  return active;
}

export async function recordUnauthorizedEmailForIp(
  ipAddress: string,
  nowMs = Date.now(),
): Promise<UnauthorizedEmailAttemptResult> {
  const db = getDb();
  const nowIso = new Date(nowMs).toISOString();
  const rows = await db
    .select()
    .from(schema.loginIpEmailRestrictions)
    .where(eq(schema.loginIpEmailRestrictions.ipAddress, ipAddress))
    .limit(1);
  const existing = rows[0];

  const { state, result } = applyUnauthorizedEmailAttempt(
    toState(existing),
    nowMs,
  );

  if (existing) {
    await db
      .update(schema.loginIpEmailRestrictions)
      .set({
        failedEmailAttempts: state.failedEmailAttempts,
        penaltyLevel: state.penaltyLevel,
        restrictedUntil: state.restrictedUntil,
        updatedAt: nowIso,
      })
      .where(eq(schema.loginIpEmailRestrictions.ipAddress, ipAddress));
  } else {
    await db.insert(schema.loginIpEmailRestrictions).values({
      ipAddress,
      failedEmailAttempts: state.failedEmailAttempts,
      penaltyLevel: state.penaltyLevel,
      restrictedUntil: state.restrictedUntil,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  return result;
}

export async function clearIpEmailRestriction(ipAddress: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.loginIpEmailRestrictions)
    .where(eq(schema.loginIpEmailRestrictions.ipAddress, ipAddress));
}
