/// <reference types="@cloudflare/workers-types" />

import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema";
import {
  stageCloudflareInboundEmail,
  type CloudflareForwardableEmailMessage,
} from "../src/lib/mail/cloudflare-email-inbound-adapter";
import {
  materializeInboundIngestionEvent,
} from "../src/lib/mail/inbound-message-materialization-service";
import {
  createInboundAttachmentStore,
} from "../src/lib/mail/inbound-attachment-store";
import type { StageInboundProviderEventResult } from "../src/lib/mail/inbound-provider-staging-service";
import {
  rejectInboundEmailRecipient,
} from "../src/lib/mail/inbound-email-recipient-reject";
import { createInboundRawPayloadStore } from "../src/lib/mail/inbound-raw-payload-store";

/** Dedicated inbound-mail Worker bindings — D1 + R2 only. No outbound email capability. */
export interface InboundMailEnv {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
}

export function assertInboundMailBindings(env: InboundMailEnv): void {
  if (!env.DB) {
    throw new Error("Inbound Mail Worker requires DB D1 binding");
  }
  if (!env.ATTACHMENTS) {
    throw new Error("Inbound Mail Worker requires ATTACHMENTS R2 binding");
  }
}

/**
 * Best-effort fast path after durable staging. The raw MIME and routing rows
 * already exist before this runs, so a timeout or failure remains recoverable
 * by mail-jobs-cron.
 */
export async function materializeStagedInboundMessages(
  staged: StageInboundProviderEventResult,
  env: InboundMailEnv,
): Promise<void> {
  if (!staged.durablyStaged || !staged.safeToAcknowledgeProvider) {
    return;
  }

  const db = drizzle(env.DB, { schema });
  const rawPayloadStore = createInboundRawPayloadStore(env.ATTACHMENTS);
  const attachmentStore = createInboundAttachmentStore(
    env.ATTACHMENTS,
    "crm-attachments",
  );

  for (const envelopeResult of staged.envelopeResults) {
    if (envelopeResult.providerStatus !== "pending") {
      continue;
    }

    try {
      await materializeInboundIngestionEvent(
        db,
        { rawPayloadStore, attachmentStore },
        { ingestionEventId: envelopeResult.ingestionEventId },
      );
    } catch (error: unknown) {
      // Durable staging has already succeeded. Leave recovery to the existing
      // leased cron path and keep the Email Routing acceptance successful.
      console.error(
        "[inbound-mail] fast-path materialization failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }
}

/**
 * Execute one Cloudflare Email Routing ingress event into durable inbound staging.
 * Acknowledges only when raw payload and dedupe rows are durably persisted.
 */
export async function handleCloudflareInboundEmail(
  message: CloudflareForwardableEmailMessage,
  env: InboundMailEnv,
): Promise<StageInboundProviderEventResult> {
  assertInboundMailBindings(env);
  const db = drizzle(env.DB, { schema });
  const payloadStore = createInboundRawPayloadStore(env.ATTACHMENTS);
  return stageCloudflareInboundEmail(db, payloadStore, message);
}

export type InboundEmailDeliveryOutcome = "accepted" | "rejected";

/**
 * Email Worker boundary — explicit SMTP reject for deterministic recipient-invalid
 * ingress errors; infrastructure failures remain internal Worker failures.
 */
export async function handleInboundEmailDelivery(
  message: CloudflareForwardableEmailMessage,
  env: InboundMailEnv,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<InboundEmailDeliveryOutcome> {
  try {
    const staged = await handleCloudflareInboundEmail(message, env);
    if (ctx) {
      ctx.waitUntil(materializeStagedInboundMessages(staged, env));
    }
    return "accepted";
  } catch (error: unknown) {
    if (rejectInboundEmailRecipient(message, error)) {
      console.error("[inbound-mail] recipient rejected");
      return "rejected";
    }

    const messageText =
      error instanceof Error ? error.message : "Inbound email staging failed";
    console.error("[inbound-mail] failed", messageText);
    throw error;
  }
}

/**
 * Standalone Cloudflare Worker for inbound Email Routing (Phase 2H-6M.2).
 * Deploy with: npm run inbound-mail:deploy
 *
 * email() only — no public HTTP API and no outbound email binding.
 * Email Routing rule attachment is a separate human-approved activation phase.
 */
export default {
  async email(
    message: CloudflareForwardableEmailMessage,
    env: InboundMailEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    await handleInboundEmailDelivery(message, env, ctx);
  },
};
