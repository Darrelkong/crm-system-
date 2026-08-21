import {
  DELIVERY_QUARANTINE_REASONS,
  type DeliveryQuarantineReason,
} from "@/lib/mail/delivery-quarantine-reasons";
import {
  INBOUND_QUARANTINE_REASONS,
  type InboundQuarantineReason,
} from "@/lib/mail/inbound-quarantine-reasons";

export type QuarantineReplayClassification =
  | "replayable_after_external_state_change"
  | "non_replayable_integrity_failure"
  | "unknown_reason";

/** Inbound reasons that may resolve after routing/config/mailbox state changes. */
export const INBOUND_REPLAYABLE_QUARANTINE_REASONS = [
  INBOUND_QUARANTINE_REASONS.unknownReceivingAddress,
  INBOUND_QUARANTINE_REASONS.receivingAddressSuspended,
  INBOUND_QUARANTINE_REASONS.routeOwnerSuspended,
  INBOUND_QUARANTINE_REASONS.fallbackNotConfigured,
  INBOUND_QUARANTINE_REASONS.fallbackUnusable,
  INBOUND_QUARANTINE_REASONS.recursiveFallback,
  INBOUND_QUARANTINE_REASONS.materializationTargetUnusable,
] as const satisfies readonly InboundQuarantineReason[];

/** Inbound reasons that must never transition back to pending via replay. */
export const INBOUND_NON_REPLAYABLE_QUARANTINE_REASONS = [
  INBOUND_QUARANTINE_REASONS.receivingAddressRetired,
  INBOUND_QUARANTINE_REASONS.routingIntegrityConflict,
  INBOUND_QUARANTINE_REASONS.integrityConflict,
  INBOUND_QUARANTINE_REASONS.payloadIntegrityConflict,
  INBOUND_QUARANTINE_REASONS.mimeParseFailure,
  INBOUND_QUARANTINE_REASONS.senderInvariantFailure,
  INBOUND_QUARANTINE_REASONS.rfcMessageIdCollision,
] as const satisfies readonly InboundQuarantineReason[];

/** Delivery reasons replayable when exact correlation dependency becomes available. */
export const DELIVERY_REPLAYABLE_QUARANTINE_REASONS = [
  DELIVERY_QUARANTINE_REASONS.correlationUnresolved,
  DELIVERY_QUARANTINE_REASONS.sendNotAccepted,
] as const satisfies readonly DeliveryQuarantineReason[];

/** Delivery integrity failures — replay cannot fix immutable semantics. */
export const DELIVERY_NON_REPLAYABLE_QUARANTINE_REASONS = [
  DELIVERY_QUARANTINE_REASONS.missingProviderMessageId,
  DELIVERY_QUARANTINE_REASONS.missingProviderEventId,
  DELIVERY_QUARANTINE_REASONS.ambiguousTransportAttempt,
  DELIVERY_QUARANTINE_REASONS.recipientNotOnRevision,
  DELIVERY_QUARANTINE_REASONS.transportNotAccepted,
  DELIVERY_QUARANTINE_REASONS.dedupeIntegrityConflict,
  DELIVERY_QUARANTINE_REASONS.payloadIntegrityConflict,
  DELIVERY_QUARANTINE_REASONS.integrityConflict,
] as const satisfies readonly DeliveryQuarantineReason[];

const INBOUND_REPLAYABLE_SET = new Set<string>(INBOUND_REPLAYABLE_QUARANTINE_REASONS);
const INBOUND_NON_REPLAYABLE_SET = new Set<string>(
  INBOUND_NON_REPLAYABLE_QUARANTINE_REASONS,
);
const DELIVERY_REPLAYABLE_SET = new Set<string>(DELIVERY_REPLAYABLE_QUARANTINE_REASONS);
const DELIVERY_NON_REPLAYABLE_SET = new Set<string>(
  DELIVERY_NON_REPLAYABLE_QUARANTINE_REASONS,
);

export function classifyInboundQuarantineReason(
  reason: string | null | undefined,
): QuarantineReplayClassification {
  if (!reason) {
    return "unknown_reason";
  }
  if (INBOUND_REPLAYABLE_SET.has(reason)) {
    return "replayable_after_external_state_change";
  }
  if (INBOUND_NON_REPLAYABLE_SET.has(reason)) {
    return "non_replayable_integrity_failure";
  }
  return "unknown_reason";
}

export function classifyDeliveryQuarantineReason(
  reason: string | null | undefined,
): QuarantineReplayClassification {
  if (!reason) {
    return "unknown_reason";
  }
  if (DELIVERY_REPLAYABLE_SET.has(reason)) {
    return "replayable_after_external_state_change";
  }
  if (DELIVERY_NON_REPLAYABLE_SET.has(reason)) {
    return "non_replayable_integrity_failure";
  }
  return "unknown_reason";
}

export function isInboundQuarantineReasonReplayable(
  reason: string | null | undefined,
): boolean {
  return classifyInboundQuarantineReason(reason) === "replayable_after_external_state_change";
}

export function isDeliveryQuarantineReasonReplayable(
  reason: string | null | undefined,
): boolean {
  return classifyDeliveryQuarantineReason(reason) === "replayable_after_external_state_change";
}

export function inboundReplayRequiresLiveRouteResolution(
  inboundChild: {
    resolvedRouteMode: string | null;
  },
  quarantineReason: string | null | undefined,
): boolean {
  if (inboundChild.resolvedRouteMode) {
    return false;
  }
  return isInboundQuarantineReasonReplayable(quarantineReason);
}

export function inboundReplayPreservesFrozenSnapshot(
  inboundChild: {
    resolvedRouteMode: string | null;
  },
): boolean {
  return inboundChild.resolvedRouteMode === "direct" ||
    inboundChild.resolvedRouteMode === "fallback";
}
