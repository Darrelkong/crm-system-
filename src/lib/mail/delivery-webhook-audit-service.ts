import { sql } from "drizzle-orm";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import type { Database } from "@/lib/db";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { runMailBatch } from "@/lib/mail/guarded-batch";
import type { DeliveryWebhookRejectionReason } from "@/lib/mail/delivery-webhook-signature";
import {
  SYSTEM_MAIL_ACTOR,
  withSystemAuditMetadata,
} from "@/lib/mail/system-mail-actor";

const DELIVERY_WEBHOOK_AUDIT_ENTITY_TYPE = "mail_delivery_webhook" as const;

function buildDeliveryWebhookAuditInsert(
  db: Database,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(
    withSystemAuditMetadata(SYSTEM_MAIL_ACTOR, input.metadata),
  );
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${input.auditId} AS id,
        NULL AS user_id,
        ${input.action} AS action,
        ${DELIVERY_WEBHOOK_AUDIT_ENTITY_TYPE} AS entity_type,
        ${input.entityId} AS entity_id,
        NULL AS ip_address,
        NULL AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

export async function recordDeliveryWebhookAccepted(
  db: Database,
  input: {
    provider: string;
    providerEventId: string;
    ingestionEventId: string;
    idempotentReplay: boolean;
    timestampSeconds: number;
    receivedAt: string;
  },
): Promise<void> {
  await runMailBatch(db, [
    buildDeliveryWebhookAuditInsert(db, {
      auditId: crypto.randomUUID(),
      now: input.receivedAt,
      action: MAIL_AUDIT_ACTIONS.deliveryWebhookAccepted,
      entityId: input.ingestionEventId || input.providerEventId,
      metadata: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        ingestionEventId: input.ingestionEventId,
        idempotentReplay: input.idempotentReplay,
        timestampSeconds: input.timestampSeconds,
      },
    }),
  ]);
}

export async function recordDeliveryWebhookRejected(
  db: Database,
  input: {
    provider: string;
    providerEventId?: string | null;
    rejectionReason: DeliveryWebhookRejectionReason | "duplicate_event" | "invalid_payload";
    reason: string;
    receivedAt: string;
    timestampSeconds?: number | null;
  },
): Promise<void> {
  const entityId =
    input.providerEventId?.trim() ||
    `${input.provider}:${input.rejectionReason}:${input.receivedAt}`;

  await runMailBatch(db, [
    buildDeliveryWebhookAuditInsert(db, {
      auditId: crypto.randomUUID(),
      now: input.receivedAt,
      action: MAIL_AUDIT_ACTIONS.deliveryWebhookRejected,
      entityId,
      metadata: {
        provider: input.provider,
        providerEventId: input.providerEventId ?? null,
        rejectionReason: input.rejectionReason,
        reason: input.reason,
        timestampSeconds: input.timestampSeconds ?? null,
      },
    }),
  ]);
}
