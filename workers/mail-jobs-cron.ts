/// <reference types="@cloudflare/workers-types" />

import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema";
import { createCloudflareEmailNotificationTransport } from "../src/lib/mail/cloudflare-email-notification-transport-adapter";
import {
  CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID_ENV,
  CLOUDFLARE_EMAIL_SENDING_API_TOKEN_ENV,
  resolveCloudflareEmailServiceRestVerificationTransportConfig,
} from "../src/lib/mail/cloudflare-email-service-rest-verification-transport";
import { createEmailNotificationVerificationChallengeSink } from "../src/lib/mail/notification-verification-challenge-delivery";
import {
  isMailNotificationVerificationTransportEnabled,
  MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR,
} from "../src/lib/mail/notification-verification-transport";
import {
  MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR,
  requireNotificationVerificationSecretFromEnv,
} from "../src/lib/mail/notification-verification-secret";
import { createInboundAttachmentStore } from "../src/lib/mail/inbound-attachment-store";
import { createInboundRawPayloadStore } from "../src/lib/mail/inbound-raw-payload-store";
import {
  runMailBackgroundTick,
  type MailBackgroundTickDeps,
  type MailBackgroundTickSummary,
} from "../src/lib/mail/mail-background-tick-service";
import {
  MAIL_BUSINESS_EMAIL_BINDING_NAME,
  type OutboundBusinessEmailBindingEnv,
} from "../src/lib/mail/outbound-business-email-binding";
import {
  MAIL_OUTBOUND_TRANSPORT_MODE_VAR,
  resolveMailOutboundTransportMode,
} from "../src/lib/mail/outbound-transport-constants";

/** Explicit opt-in — production deploy keeps this false until controlled enablement. */
export const MAIL_NOTIFICATION_TRANSPORT_ENABLED_VAR =
  "MAIL_NOTIFICATION_TRANSPORT_ENABLED" as const;

/** Dedicated Mail Jobs Worker bindings — DB, ATTACHMENTS, optional EMAIL sending. */
export interface MailJobsEnv extends OutboundBusinessEmailBindingEnv {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  /** System notification transport — never used for business outbound. */
  EMAIL?: SendEmail;
  MAIL_NOTIFICATION_TRANSPORT_ENABLED?: string;
  MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE?: string;
  MAIL_OUTBOUND_TRANSPORT_MODE?: string;
  [MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR]?: string;
  [CLOUDFLARE_EMAIL_SENDING_API_TOKEN_ENV]?: string;
  [CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID_ENV]?: string;
}

export type MailJobsTickRunner = typeof runMailBackgroundTick;

export function isMailNotificationTransportEnabled(
  env: Pick<MailJobsEnv, typeof MAIL_NOTIFICATION_TRANSPORT_ENABLED_VAR>,
): boolean {
  return env.MAIL_NOTIFICATION_TRANSPORT_ENABLED === "true";
}

function assertMailJobsBindings(env: MailJobsEnv): void {
  if (!env.DB) {
    throw new Error("Mail Jobs Worker requires DB D1 binding");
  }
  if (!env.ATTACHMENTS) {
    throw new Error("Mail Jobs Worker requires ATTACHMENTS R2 binding");
  }
}

function assertNotificationTransportBindings(env: MailJobsEnv): void {
  if (!env.EMAIL) {
    throw new Error(
      "Mail Jobs Worker requires EMAIL send_email binding when MAIL_NOTIFICATION_TRANSPORT_ENABLED is true",
    );
  }
}

function assertVerificationRestTransportConfig(env: MailJobsEnv): void {
  try {
    resolveCloudflareEmailServiceRestVerificationTransportConfig(env);
  } catch {
    throw new Error(
      "Mail Jobs Worker requires CLOUDFLARE_EMAIL_SENDING_API_TOKEN secret and CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID when MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE is production",
    );
  }
}

function assertMailJobsVerificationSecret(env: MailJobsEnv): void {
  try {
    requireNotificationVerificationSecretFromEnv(
      env as unknown as Record<string, string | undefined>,
    );
  } catch {
    throw new Error(
      `Mail Jobs Worker requires ${MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR} secret when MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE is production`,
    );
  }
}

export function buildMailBackgroundTickDeps(
  env: MailJobsEnv,
): MailBackgroundTickDeps {
  const db = drizzle(env.DB, { schema });
  const deps: MailBackgroundTickDeps = {
    rawPayloadStore: createInboundRawPayloadStore(env.ATTACHMENTS),
    attachmentStore: createInboundAttachmentStore(
      env.ATTACHMENTS,
      "crm-attachments",
    ),
    outboundDispatch: {
      env: {
        [MAIL_OUTBOUND_TRANSPORT_MODE_VAR]: env.MAIL_OUTBOUND_TRANSPORT_MODE,
      },
      db,
      businessEmailBinding: env[MAIL_BUSINESS_EMAIL_BINDING_NAME],
      notificationEmailBinding: env.EMAIL,
      attachmentsBucket: env.ATTACHMENTS,
    },
  };

  if (
    isMailNotificationVerificationTransportEnabled({
      [MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR]:
        env.MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE,
    })
  ) {
    assertVerificationRestTransportConfig(env);
    assertMailJobsVerificationSecret(env);
    const verificationChallengeSecret =
      requireNotificationVerificationSecretFromEnv(
        env as unknown as Record<string, string | undefined>,
      );
    deps.verificationChallengeSecret = verificationChallengeSecret;
    const restConfig = resolveCloudflareEmailServiceRestVerificationTransportConfig(
      env,
    );
    deps.verificationChallengeSink =
      createEmailNotificationVerificationChallengeSink(restConfig);
  }

  if (isMailNotificationTransportEnabled(env)) {
    assertNotificationTransportBindings(env);

    deps.notificationTransport = createCloudflareEmailNotificationTransport({
      emailBinding: env.EMAIL!,
    });
  }

  return deps;
}

/** Privacy-safe tick summary for Worker observability — no MIME, addresses, or secrets. */
export function formatMailJobsTickLogSummary(
  summary: MailBackgroundTickSummary,
  durationMs: number,
): Record<string, unknown> {
  return {
    durationMs,
    totalItemsStarted: summary.totalItemsStarted,
    stoppedReason: summary.stoppedReason ?? null,
    notificationDispatchSkipped: summary.notificationDispatchSkipped,
    verificationDispatchSkipped: summary.verificationDispatchSkipped,
    providerProcessingRecovery: summary.providerProcessingRecovery,
    notificationProcessingRecovery: summary.notificationProcessingRecovery,
    inboundMaterialization: summary.inboundMaterialization,
    deliveryMaterialization: summary.deliveryMaterialization,
    notificationDispatch: summary.notificationDispatch,
    verificationDispatch: summary.verificationDispatch,
    outboundDispatch: summary.outboundDispatch,
    outboundDispatchSkipped: summary.outboundDispatchSkipped,
    outboundSentMaterialization: summary.outboundSentMaterialization,
    rawPayloadRetention: summary.rawPayloadRetention,
  };
}

/**
 * Execute one bounded Mail background tick from Worker bindings.
 * Notification transport stays disabled unless MAIL_NOTIFICATION_TRANSPORT_ENABLED=true.
 */
export async function runMailJobsScheduledTick(
  env: MailJobsEnv,
  options?: { runTick?: MailJobsTickRunner },
): Promise<MailBackgroundTickSummary> {
  assertMailJobsBindings(env);

  const db = drizzle(env.DB, { schema });
  const runTick = options?.runTick ?? runMailBackgroundTick;

  return runTick(db, buildMailBackgroundTickDeps(env));
}

/**
 * Standalone Cloudflare Worker for Mail background processing (Phase 2C.12C.2A).
 * Cron source schedule: every 3 minutes (see wrangler.mail-jobs-cron.jsonc).
 * Deploy with: npm run cron:mail:deploy
 *
 * Scheduled-only — no public business API. System authority via frozen 2C.12C.1 services.
 */
export default {
  async scheduled(
    _event: ScheduledEvent,
    env: MailJobsEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    const startedAt = Date.now();

    ctx.waitUntil(
      runMailJobsScheduledTick(env)
        .then((summary) => {
          console.log(
            "[mail-jobs-cron] completed",
            JSON.stringify(formatMailJobsTickLogSummary(summary, Date.now() - startedAt)),
          );
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : "Mail jobs tick failed";
          console.error("[mail-jobs-cron] failed", message);
          throw error;
        }),
    );
  },
};
