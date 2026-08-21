import type { MailActorContext } from "@/lib/mail/actor-context";

/** Trusted internal source for future mail-jobs-cron Worker — not HTTP-assignable. */
export const SYSTEM_MAIL_JOBS_SOURCE = "mail_jobs_cron" as const;

export type SystemMailActorContext = {
  kind: "system";
  userId: null;
  source: typeof SYSTEM_MAIL_JOBS_SOURCE;
  audit: {
    ipAddress: null;
    userAgent: null;
  };
};

export type MailOperationalActor = MailActorContext | SystemMailActorContext;

export function isSystemMailActor(
  actor: MailOperationalActor,
): actor is SystemMailActorContext {
  return "kind" in actor && actor.kind === "system";
}

/**
 * Trusted system actor for background job runners.
 * Must NOT impersonate Admin, super_admin, delivery_health, or any human user.
 * No fake users row — audit_logs.user_id remains NULL for system actions.
 */
export const SYSTEM_MAIL_ACTOR: SystemMailActorContext = {
  kind: "system",
  userId: null,
  source: SYSTEM_MAIL_JOBS_SOURCE,
  audit: {
    ipAddress: null,
    userAgent: null,
  },
};

export function resolveMailAuditUserId(
  actor: MailOperationalActor,
): string | null {
  return isSystemMailActor(actor) ? null : actor.userId;
}

export function resolveMailAuditIpAddress(
  actor: MailOperationalActor,
): string | null {
  return isSystemMailActor(actor) ? null : (actor.audit.ipAddress ?? null);
}

export function resolveMailAuditUserAgent(
  actor: MailOperationalActor,
): string | null {
  return isSystemMailActor(actor) ? null : (actor.audit.userAgent ?? null);
}

export function withSystemAuditMetadata(
  actor: MailOperationalActor,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  if (!isSystemMailActor(actor)) {
    return metadata;
  }
  return {
    ...metadata,
    initiator: "system",
    source: actor.source,
  };
}
