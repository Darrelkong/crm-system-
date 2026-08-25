import { and, eq, gte, sql } from "drizzle-orm";
import type { MailSendOperation } from "../../../drizzle/schema/mail-send-operations";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";

/** Configurable outbound send rate limits — enforced at preflight, no provider calls. */
export const MAIL_OUTBOUND_SEND_RATE_LIMIT_VARS = {
  maxDispatchesPerUserPerHour:
    "MAIL_OUTBOUND_SEND_MAX_DISPATCHES_PER_USER_HOUR",
  maxInitiatedPerUserPerHour:
    "MAIL_OUTBOUND_SEND_MAX_INITIATED_PER_USER_HOUR",
  maxRecipientsPerBatch: "MAIL_OUTBOUND_SEND_MAX_RECIPIENTS_PER_BATCH",
} as const;

export type OutboundSendRateLimitConfig = {
  maxDispatchesPerUserPerHour: number;
  maxInitiatedPerUserPerHour: number;
  maxRecipientsPerBatch: number;
};

export const OUTBOUND_SEND_RATE_LIMIT_DEFAULTS: OutboundSendRateLimitConfig = {
  maxDispatchesPerUserPerHour: 120,
  maxInitiatedPerUserPerHour: 120,
  maxRecipientsPerBatch: 50,
};

const ONE_HOUR_MS = 60 * 60 * 1000;

function readPositiveInt(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

export function resolveOutboundSendRateLimitConfig(
  env: Record<string, string | undefined> = process.env,
): OutboundSendRateLimitConfig {
  return {
    maxDispatchesPerUserPerHour: readPositiveInt(
      env,
      MAIL_OUTBOUND_SEND_RATE_LIMIT_VARS.maxDispatchesPerUserPerHour,
      OUTBOUND_SEND_RATE_LIMIT_DEFAULTS.maxDispatchesPerUserPerHour,
    ),
    maxInitiatedPerUserPerHour: readPositiveInt(
      env,
      MAIL_OUTBOUND_SEND_RATE_LIMIT_VARS.maxInitiatedPerUserPerHour,
      OUTBOUND_SEND_RATE_LIMIT_DEFAULTS.maxInitiatedPerUserPerHour,
    ),
    maxRecipientsPerBatch: readPositiveInt(
      env,
      MAIL_OUTBOUND_SEND_RATE_LIMIT_VARS.maxRecipientsPerBatch,
      OUTBOUND_SEND_RATE_LIMIT_DEFAULTS.maxRecipientsPerBatch,
    ),
  };
}

export type OutboundSendRateLimitPhase = "initiate" | "dispatch";

async function countSendOperationsSince(
  db: Database,
  userId: string,
  sinceIso: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mailSendOperations)
    .where(
      and(
        eq(schema.mailSendOperations.initiatedByUserId, userId),
        gte(schema.mailSendOperations.createdAt, sinceIso),
      ),
    );
  return Number(row?.count ?? 0);
}

async function countDispatchAuditsSince(
  db: Database,
  userId: string,
  sinceIso: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.userId, userId),
        eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.sendDispatchStarted),
        gte(schema.auditLogs.createdAt, sinceIso),
      ),
    );
  return Number(row?.count ?? 0);
}

export async function assertOutboundSendRateLimitsWithinPolicy(
  db: Database,
  actor: MailActorContext,
  input: {
    phase: OutboundSendRateLimitPhase;
    recipientCount: number;
    config?: OutboundSendRateLimitConfig;
    now?: Date;
  },
): Promise<void> {
  const config = input.config ?? resolveOutboundSendRateLimitConfig();
  if (input.recipientCount > config.maxRecipientsPerBatch) {
    throw MailServiceError.validation(
      `Send batch exceeds maximum ${config.maxRecipientsPerBatch} recipients`,
    );
  }

  const now = input.now ?? new Date();
  const sinceIso = new Date(now.getTime() - ONE_HOUR_MS).toISOString();

  if (input.phase === "initiate") {
    const initiated = await countSendOperationsSince(db, actor.userId, sinceIso);
    if (initiated >= config.maxInitiatedPerUserPerHour) {
      throw MailServiceError.conflict(
        "Outbound send initiation rate limit exceeded for this user",
      );
    }
    return;
  }

  const dispatches = await countDispatchAuditsSince(db, actor.userId, sinceIso);
  if (dispatches >= config.maxDispatchesPerUserPerHour) {
    throw MailServiceError.conflict(
      "Outbound send dispatch rate limit exceeded for this user",
    );
  }
}

export function summarizeRateLimitPolicy(
  config: OutboundSendRateLimitConfig = OUTBOUND_SEND_RATE_LIMIT_DEFAULTS,
): string {
  return [
    `initiated≤${config.maxInitiatedPerUserPerHour}/user/hour`,
    `dispatch≤${config.maxDispatchesPerUserPerHour}/user/hour`,
    `recipients≤${config.maxRecipientsPerBatch}/batch`,
  ].join(", ");
}
