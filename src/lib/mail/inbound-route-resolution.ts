import { eq } from "drizzle-orm";
import type { MailMailboxStatus } from "../../../drizzle/schema/mail-mailboxes";
import type { MailReceivingAddressStatus } from "../../../drizzle/schema/mail-receiving-addresses";
import { schema, type Database } from "@/lib/db";
import { getInboundFallbackMailboxConfig } from "@/lib/mail/inbound-fallback-config-service";
import {
  resolveInboundRoutingPolicy,
  type InboundFallbackConfigSnapshot,
  type InboundRoutingDecision,
} from "@/lib/mail/inbound-routing-policy";
import { INBOUND_QUARANTINE_REASONS } from "@/lib/mail/inbound-quarantine-reasons";
import type { MailInboundRouteMode } from "../../../drizzle/schema/mail-inbound-message-materializations";
import { findMailboxById } from "@/lib/mail/mailbox-service";
import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";
import { resolvedRouteFieldsForDecision } from "@/lib/mail/inbound-route-snapshot";

export type ResolvedInboundRoute = {
  normalizedEnvelopeRecipient: string;
  receivingAddressKnown: boolean;
  receivingAddressId: string | null;
  receivingAddressStatus: MailReceivingAddressStatus | null;
  routeOwnerMailboxId: string | null;
  routeOwnerMailboxStatus: MailMailboxStatus | null;
  routedAddressSnapshot: string | null;
  routeDecision: InboundRoutingDecision;
  quarantineReason: string | null;
  fallbackConfig: InboundFallbackConfigSnapshot;
  resolvedRouteMode: MailInboundRouteMode | null;
  resolvedFallbackMailboxId: string | null;
};

function mapDecisionToQuarantineReason(input: {
  receivingAddressKnown: boolean;
  receivingAddressStatus: MailReceivingAddressStatus | null;
  routeOwnerMailboxStatus: MailMailboxStatus | null;
  routeDecision: InboundRoutingDecision;
  fallbackConfig: InboundFallbackConfigSnapshot;
  routeOwnerMailboxId: string | null;
}): string | null {
  if (input.routeDecision !== "quarantine") {
    return null;
  }

  if (!input.receivingAddressKnown) {
    return INBOUND_QUARANTINE_REASONS.unknownReceivingAddress;
  }

  if (input.routeOwnerMailboxStatus === "suspended") {
    return INBOUND_QUARANTINE_REASONS.routeOwnerSuspended;
  }

  if (
    input.receivingAddressStatus === "suspended" &&
    input.routeOwnerMailboxStatus === "active"
  ) {
    return INBOUND_QUARANTINE_REASONS.receivingAddressSuspended;
  }

  if (
    input.receivingAddressStatus === "retired" &&
    input.routeOwnerMailboxStatus === "active"
  ) {
    return INBOUND_QUARANTINE_REASONS.receivingAddressRetired;
  }

  if (
    input.routeOwnerMailboxStatus === "archived" ||
    input.routeOwnerMailboxStatus === "deleted"
  ) {
    if (!input.fallbackConfig.configured) {
      return INBOUND_QUARANTINE_REASONS.fallbackNotConfigured;
    }
    if (
      input.fallbackConfig.mailboxId &&
      input.routeOwnerMailboxId &&
      input.fallbackConfig.mailboxId === input.routeOwnerMailboxId
    ) {
      return INBOUND_QUARANTINE_REASONS.recursiveFallback;
    }
    return INBOUND_QUARANTINE_REASONS.fallbackUnusable;
  }

  return INBOUND_QUARANTINE_REASONS.routingIntegrityConflict;
}

function finalizeResolvedRouteFields(
  routeDecision: InboundRoutingDecision,
  fallbackConfig: InboundFallbackConfigSnapshot,
): {
  resolvedRouteMode: MailInboundRouteMode | null;
  resolvedFallbackMailboxId: string | null;
} {
  const fallbackMailboxId =
    routeDecision === "fallback" ? fallbackConfig.mailboxId : null;
  return resolvedRouteFieldsForDecision(routeDecision, fallbackMailboxId);
}

function buildResolvedRoute(
  base: Omit<
    ResolvedInboundRoute,
    "resolvedRouteMode" | "resolvedFallbackMailboxId"
  >,
): ResolvedInboundRoute {
  const { resolvedRouteMode, resolvedFallbackMailboxId } =
    finalizeResolvedRouteFields(base.routeDecision, base.fallbackConfig);
  return {
    ...base,
    resolvedRouteMode,
    resolvedFallbackMailboxId,
  };
}

async function findReceivingAddressByNormalizedAddress(
  db: Database,
  normalizedAddress: string,
) {
  const [row] = await db
    .select()
    .from(schema.mailReceivingAddresses)
    .where(eq(schema.mailReceivingAddresses.address, normalizedAddress))
    .limit(1);
  return row ?? null;
}

function toFallbackSnapshot(
  config: Awaited<ReturnType<typeof getInboundFallbackMailboxConfig>>,
): InboundFallbackConfigSnapshot {
  return {
    configured: config.configured,
    mailboxId: config.mailboxId,
    mailboxStatus: config.mailboxStatus,
    mailboxType: config.mailboxType,
  };
}

/**
 * Resolve inbound route for one envelope recipient using frozen 2C.9B policy.
 * Never queries mail_sender_identities.
 */
export async function resolveInboundRouteForEnvelope(
  db: Database,
  rawEnvelopeRecipient: string,
): Promise<ResolvedInboundRoute> {
  const normalizedEnvelopeRecipient = normalizeMailEmailAddress(
    rawEnvelopeRecipient,
  );
  const fallbackConfigView = await getInboundFallbackMailboxConfig(db);
  const fallbackConfig = toFallbackSnapshot(fallbackConfigView);

  const receivingAddress = await findReceivingAddressByNormalizedAddress(
    db,
    normalizedEnvelopeRecipient,
  );

  if (!receivingAddress) {
    const routeDecision = resolveInboundRoutingPolicy({
      receivingAddressKnown: false,
      receivingAddressStatus: null,
      routeOwnerMailboxId: null,
      routeOwnerMailboxStatus: null,
      fallbackConfig,
    });
    return buildResolvedRoute({
      normalizedEnvelopeRecipient,
      receivingAddressKnown: false,
      receivingAddressId: null,
      receivingAddressStatus: null,
      routeOwnerMailboxId: null,
      routeOwnerMailboxStatus: null,
      routedAddressSnapshot: null,
      routeDecision,
      quarantineReason: mapDecisionToQuarantineReason({
        receivingAddressKnown: false,
        receivingAddressStatus: null,
        routeOwnerMailboxStatus: null,
        routeDecision,
        fallbackConfig,
        routeOwnerMailboxId: null,
      }),
      fallbackConfig,
    });
  }

  const ownerMailbox = await findMailboxById(db, receivingAddress.mailboxId);
  if (!ownerMailbox) {
    const routeDecision = "quarantine" as const;
    return buildResolvedRoute({
      normalizedEnvelopeRecipient,
      receivingAddressKnown: true,
      receivingAddressId: receivingAddress.id,
      receivingAddressStatus: receivingAddress.status,
      routeOwnerMailboxId: receivingAddress.mailboxId,
      routeOwnerMailboxStatus: null,
      routedAddressSnapshot: receivingAddress.address,
      routeDecision,
      quarantineReason: INBOUND_QUARANTINE_REASONS.routingIntegrityConflict,
      fallbackConfig,
    });
  }

  const routeDecision = resolveInboundRoutingPolicy({
    receivingAddressKnown: true,
    receivingAddressStatus: receivingAddress.status,
    routeOwnerMailboxId: ownerMailbox.id,
    routeOwnerMailboxStatus: ownerMailbox.status,
    fallbackConfig,
  });

  return buildResolvedRoute({
    normalizedEnvelopeRecipient,
    receivingAddressKnown: true,
    receivingAddressId: receivingAddress.id,
    receivingAddressStatus: receivingAddress.status,
    routeOwnerMailboxId: ownerMailbox.id,
    routeOwnerMailboxStatus: ownerMailbox.status,
    routedAddressSnapshot: receivingAddress.address,
    routeDecision,
    quarantineReason: mapDecisionToQuarantineReason({
      receivingAddressKnown: true,
      receivingAddressStatus: receivingAddress.status,
      routeOwnerMailboxStatus: ownerMailbox.status,
      routeDecision,
      fallbackConfig,
      routeOwnerMailboxId: ownerMailbox.id,
    }),
    fallbackConfig,
  });
}
