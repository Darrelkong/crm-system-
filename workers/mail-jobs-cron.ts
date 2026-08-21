/// <reference types="@cloudflare/workers-types" />

import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema";
import { createInboundAttachmentStore } from "../src/lib/mail/inbound-attachment-store";
import { createInboundRawPayloadStore } from "../src/lib/mail/inbound-raw-payload-store";
import {
  runMailBackgroundTick,
  type MailBackgroundTickSummary,
} from "../src/lib/mail/mail-background-tick-service";

/** Dedicated Mail Jobs Worker bindings — DB + private ATTACHMENTS only. */
export interface MailJobsEnv {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
}

export type MailJobsTickRunner = typeof runMailBackgroundTick;

function assertMailJobsBindings(env: MailJobsEnv): void {
  if (!env.DB) {
    throw new Error("Mail Jobs Worker requires DB D1 binding");
  }
  if (!env.ATTACHMENTS) {
    throw new Error("Mail Jobs Worker requires ATTACHMENTS R2 binding");
  }
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
    providerProcessingRecovery: summary.providerProcessingRecovery,
    notificationProcessingRecovery: summary.notificationProcessingRecovery,
    inboundMaterialization: summary.inboundMaterialization,
    deliveryMaterialization: summary.deliveryMaterialization,
    notificationDispatch: summary.notificationDispatch,
  };
}

/**
 * Execute one bounded Mail background tick from Worker bindings.
 * Production path omits NotificationTransportAdapter — dispatch stays disabled.
 */
export async function runMailJobsScheduledTick(
  env: MailJobsEnv,
  options?: { runTick?: MailJobsTickRunner },
): Promise<MailBackgroundTickSummary> {
  assertMailJobsBindings(env);

  const db = drizzle(env.DB, { schema });
  const rawPayloadStore = createInboundRawPayloadStore(env.ATTACHMENTS);
  const attachmentStore = createInboundAttachmentStore(
    env.ATTACHMENTS,
    "crm-attachments",
  );

  const runTick = options?.runTick ?? runMailBackgroundTick;

  return runTick(db, {
    rawPayloadStore,
    attachmentStore,
  });
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
