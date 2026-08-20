import type { MailInboundIngestionEvent } from "../../../drizzle/schema/mail-inbound-ingestion-events";
import type { MailInboundRouteMode } from "../../../drizzle/schema/mail-inbound-message-materializations";
import type { MailProviderIngestionEvent } from "../../../drizzle/schema/mail-provider-ingestion-events";
import type { InboundRoutingDecision } from "@/lib/mail/inbound-routing-policy";

export type FrozenInboundRouteSnapshot = {
  resolvedRouteMode: MailInboundRouteMode | null;
  resolvedFallbackMailboxId: string | null;
  receivingAddressId: string | null;
  routeOwnerMailboxId: string | null;
  routedAddressSnapshot: string | null;
};

export function routeDecisionFromSnapshot(
  snapshot: FrozenInboundRouteSnapshot,
  providerStatus: MailProviderIngestionEvent["status"],
): InboundRoutingDecision {
  if (snapshot.resolvedRouteMode === "direct") {
    return "direct";
  }
  if (snapshot.resolvedRouteMode === "fallback") {
    return "fallback";
  }
  if (providerStatus === "quarantined") {
    return "quarantine";
  }
  return "quarantine";
}

export function frozenRouteSnapshotFromInboundChild(
  inboundChild: MailInboundIngestionEvent,
): FrozenInboundRouteSnapshot {
  return {
    resolvedRouteMode: inboundChild.resolvedRouteMode ?? null,
    resolvedFallbackMailboxId: inboundChild.resolvedFallbackMailboxId ?? null,
    receivingAddressId: inboundChild.receivingAddressId ?? null,
    routeOwnerMailboxId: inboundChild.routeOwnerMailboxId ?? null,
    routedAddressSnapshot: inboundChild.routedAddressSnapshot ?? null,
  };
}

/**
 * Pending direct/fallback events require a durable route-resolution snapshot
 * before safeToAcknowledgeProvider. Quarantined events do not require mode/fallback.
 *
 * Future 2C.10 materialization MUST consume this frozen snapshot — not live config.
 * If frozen fallback mailbox becomes non-operational before materialization:
 * fail closed (quarantine/block) — do NOT silently retarget to current config.
 */
export function isInboundRouteSnapshotAckSafe(input: {
  providerEvent: Pick<
    MailProviderIngestionEvent,
    "status" | "payloadStorageKey" | "payloadContentHash" | "payloadSizeBytes"
  >;
  inboundChild: MailInboundIngestionEvent | null;
}): boolean {
  const { providerEvent, inboundChild } = input;
  if (
    !inboundChild ||
    !providerEvent.payloadStorageKey ||
    !providerEvent.payloadContentHash ||
    providerEvent.payloadSizeBytes == null
  ) {
    return false;
  }

  if (providerEvent.status === "quarantined") {
    return true;
  }

  if (providerEvent.status !== "pending") {
    return false;
  }

  const provenanceResolved =
    inboundChild.receivingAddressId &&
    inboundChild.routeOwnerMailboxId &&
    inboundChild.routedAddressSnapshot &&
    inboundChild.routedAt;

  if (inboundChild.resolvedRouteMode === "direct") {
    return Boolean(provenanceResolved);
  }

  if (inboundChild.resolvedRouteMode === "fallback") {
    return Boolean(
      provenanceResolved && inboundChild.resolvedFallbackMailboxId,
    );
  }

  return false;
}

export function resolvedRouteFieldsForDecision(
  routeDecision: InboundRoutingDecision,
  fallbackMailboxId: string | null,
): {
  resolvedRouteMode: MailInboundRouteMode | null;
  resolvedFallbackMailboxId: string | null;
} {
  if (routeDecision === "direct") {
    return {
      resolvedRouteMode: "direct",
      resolvedFallbackMailboxId: null,
    };
  }
  if (routeDecision === "fallback") {
    if (!fallbackMailboxId) {
      throw new Error("Fallback route requires a validated fallback mailbox id");
    }
    return {
      resolvedRouteMode: "fallback",
      resolvedFallbackMailboxId: fallbackMailboxId,
    };
  }
  return {
    resolvedRouteMode: null,
    resolvedFallbackMailboxId: null,
  };
}
