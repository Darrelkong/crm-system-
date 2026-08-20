import type { MailMailboxStatus, MailMailboxType } from "../../../drizzle/schema/mail-mailboxes";
import type { MailReceivingAddressStatus } from "../../../drizzle/schema/mail-receiving-addresses";

export const INBOUND_ROUTING_DECISIONS = [
  "direct",
  "fallback",
  "quarantine",
] as const;
export type InboundRoutingDecision =
  (typeof INBOUND_ROUTING_DECISIONS)[number];

export type InboundFallbackConfigSnapshot = {
  configured: boolean;
  mailboxId: string | null;
  mailboxStatus: MailMailboxStatus | null;
  mailboxType: MailMailboxType | null;
};

export type InboundRoutingPolicyInput = {
  /** Envelope recipient matched a mail_receiving_addresses row. */
  receivingAddressKnown: boolean;
  receivingAddressStatus: MailReceivingAddressStatus | null;
  routeOwnerMailboxId: string | null;
  routeOwnerMailboxStatus: MailMailboxStatus | null;
  fallbackConfig: InboundFallbackConfigSnapshot;
};

/**
 * Pure V1 inbound routing precedence (Phase 2C.9B — frozen).
 *
 * Source of truth: mail_receiving_addresses only — never Sender Identity.
 * Does not perform address normalization or DB access.
 */
export function resolveInboundRoutingPolicy(
  input: InboundRoutingPolicyInput,
): InboundRoutingDecision {
  if (!input.receivingAddressKnown) {
    return "quarantine";
  }

  const ownerStatus = input.routeOwnerMailboxStatus;

  if (ownerStatus === "archived" || ownerStatus === "deleted") {
    return isFallbackUsable(input.fallbackConfig, input.routeOwnerMailboxId)
      ? "fallback"
      : "quarantine";
  }

  if (ownerStatus === "suspended") {
    return "quarantine";
  }

  if (ownerStatus === "active") {
    if (input.receivingAddressStatus === "active") {
      return "direct";
    }
    return "quarantine";
  }

  return "quarantine";
}

export function isFallbackUsable(
  config: InboundFallbackConfigSnapshot,
  routeOwnerMailboxId: string | null,
): boolean {
  if (!config.configured || !config.mailboxId) {
    return false;
  }
  if (config.mailboxStatus !== "active") {
    return false;
  }
  if (config.mailboxType !== "shared") {
    return false;
  }
  if (routeOwnerMailboxId && config.mailboxId === routeOwnerMailboxId) {
    return false;
  }
  return true;
}
