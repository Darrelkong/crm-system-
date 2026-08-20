import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFallbackUsable,
  resolveInboundRoutingPolicy,
  type InboundFallbackConfigSnapshot,
} from "@/lib/mail/inbound-routing-policy";

function fallbackConfig(
  partial: Partial<InboundFallbackConfigSnapshot> & {
    configured: boolean;
  },
): InboundFallbackConfigSnapshot {
  return {
    mailboxId: partial.mailboxId ?? (partial.configured ? "fallback-mailbox" : null),
    mailboxStatus: partial.mailboxStatus ?? (partial.configured ? "active" : null),
    mailboxType: partial.mailboxType ?? (partial.configured ? "shared" : null),
    configured: partial.configured,
  };
}

describe("resolveInboundRoutingPolicy", () => {
  it("active address + active owner → direct", () => {
    assert.equal(
      resolveInboundRoutingPolicy({
        receivingAddressKnown: true,
        receivingAddressStatus: "active",
        routeOwnerMailboxId: "owner-1",
        routeOwnerMailboxStatus: "active",
        fallbackConfig: fallbackConfig({ configured: false }),
      }),
      "direct",
    );
  });

  it("suspended address + active owner → quarantine", () => {
    assert.equal(
      resolveInboundRoutingPolicy({
        receivingAddressKnown: true,
        receivingAddressStatus: "suspended",
        routeOwnerMailboxId: "owner-1",
        routeOwnerMailboxStatus: "active",
        fallbackConfig: fallbackConfig({ configured: true }),
      }),
      "quarantine",
    );
  });

  it("retired address + active owner → quarantine", () => {
    assert.equal(
      resolveInboundRoutingPolicy({
        receivingAddressKnown: true,
        receivingAddressStatus: "retired",
        routeOwnerMailboxId: "owner-1",
        routeOwnerMailboxStatus: "active",
        fallbackConfig: fallbackConfig({ configured: true }),
      }),
      "quarantine",
    );
  });

  it("active/suspended address + suspended owner → quarantine", () => {
    for (const addressStatus of ["active", "suspended"] as const) {
      assert.equal(
        resolveInboundRoutingPolicy({
          receivingAddressKnown: true,
          receivingAddressStatus: addressStatus,
          routeOwnerMailboxId: "owner-1",
          routeOwnerMailboxStatus: "suspended",
          fallbackConfig: fallbackConfig({ configured: true }),
        }),
        "quarantine",
      );
    }
  });

  it("archived owner + valid fallback → fallback even when address suspended", () => {
    assert.equal(
      resolveInboundRoutingPolicy({
        receivingAddressKnown: true,
        receivingAddressStatus: "suspended",
        routeOwnerMailboxId: "owner-archived",
        routeOwnerMailboxStatus: "archived",
        fallbackConfig: fallbackConfig({
          configured: true,
          mailboxId: "fallback-mailbox",
        }),
      }),
      "fallback",
    );
  });

  it("deleted owner + valid fallback → fallback even when address retired", () => {
    assert.equal(
      resolveInboundRoutingPolicy({
        receivingAddressKnown: true,
        receivingAddressStatus: "retired",
        routeOwnerMailboxId: "owner-deleted",
        routeOwnerMailboxStatus: "deleted",
        fallbackConfig: fallbackConfig({
          configured: true,
          mailboxId: "fallback-mailbox",
        }),
      }),
      "fallback",
    );
  });

  it("archived/deleted owner + no config → quarantine", () => {
    for (const ownerStatus of ["archived", "deleted"] as const) {
      assert.equal(
        resolveInboundRoutingPolicy({
          receivingAddressKnown: true,
          receivingAddressStatus: "suspended",
          routeOwnerMailboxId: "owner-1",
          routeOwnerMailboxStatus: ownerStatus,
          fallbackConfig: fallbackConfig({ configured: false }),
        }),
        "quarantine",
      );
    }
  });

  it("archived/deleted owner + invalid/non-active fallback → quarantine", () => {
    assert.equal(
      resolveInboundRoutingPolicy({
        receivingAddressKnown: true,
        receivingAddressStatus: "suspended",
        routeOwnerMailboxId: "owner-1",
        routeOwnerMailboxStatus: "archived",
        fallbackConfig: fallbackConfig({
          configured: true,
          mailboxStatus: "suspended",
        }),
      }),
      "quarantine",
    );
  });

  it("unknown address → quarantine", () => {
    assert.equal(
      resolveInboundRoutingPolicy({
        receivingAddressKnown: false,
        receivingAddressStatus: null,
        routeOwnerMailboxId: null,
        routeOwnerMailboxStatus: null,
        fallbackConfig: fallbackConfig({ configured: true }),
      }),
      "quarantine",
    );
  });

  it("does not fallback when owner is the configured fallback mailbox", () => {
    assert.equal(
      resolveInboundRoutingPolicy({
        receivingAddressKnown: true,
        receivingAddressStatus: "suspended",
        routeOwnerMailboxId: "fallback-mailbox",
        routeOwnerMailboxStatus: "archived",
        fallbackConfig: fallbackConfig({
          configured: true,
          mailboxId: "fallback-mailbox",
        }),
      }),
      "quarantine",
    );
  });
});

describe("isFallbackUsable", () => {
  it("requires active shared configured mailbox distinct from route owner", () => {
    assert.equal(
      isFallbackUsable(
        fallbackConfig({ configured: true, mailboxId: "fb" }),
        "owner",
      ),
      true,
    );
    assert.equal(isFallbackUsable(fallbackConfig({ configured: false }), "owner"), false);
    assert.equal(
      isFallbackUsable(
        fallbackConfig({ configured: true, mailboxType: "personal" }),
        "owner",
      ),
      false,
    );
    assert.equal(
      isFallbackUsable(
        fallbackConfig({ configured: true, mailboxStatus: "archived" }),
        "owner",
      ),
      false,
    );
    assert.equal(
      isFallbackUsable(
        fallbackConfig({ configured: true, mailboxId: "same" }),
        "same",
      ),
      false,
    );
  });
});
