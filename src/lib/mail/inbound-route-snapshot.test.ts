import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isInboundRouteSnapshotAckSafe,
  resolvedRouteFieldsForDecision,
  routeDecisionFromSnapshot,
} from "@/lib/mail/inbound-route-snapshot";

describe("inbound route snapshot helpers", () => {
  it("direct route fields omit fallback mailbox", () => {
    assert.deepEqual(resolvedRouteFieldsForDecision("direct", "mb-fallback"), {
      resolvedRouteMode: "direct",
      resolvedFallbackMailboxId: null,
    });
  });

  it("fallback route fields require mailbox id", () => {
    assert.deepEqual(
      resolvedRouteFieldsForDecision("fallback", "mb-fallback"),
      {
        resolvedRouteMode: "fallback",
        resolvedFallbackMailboxId: "mb-fallback",
      },
    );
    assert.throws(() => resolvedRouteFieldsForDecision("fallback", null));
  });

  it("quarantine leaves route mode null", () => {
    assert.deepEqual(resolvedRouteFieldsForDecision("quarantine", null), {
      resolvedRouteMode: null,
      resolvedFallbackMailboxId: null,
    });
  });

  it("pending fallback requires frozen fallback id for ACK safety", () => {
    const ackSafe = isInboundRouteSnapshotAckSafe({
      providerEvent: {
        status: "pending",
        payloadStorageKey: "mail/raw-ingestion/x",
        payloadContentHash: "a".repeat(64),
        payloadSizeBytes: 10,
      },
      inboundChild: {
        id: "child",
        ingestionEventId: "evt",
        eventKind: "inbound_message",
        envelopeRecipientAddress: "a@test.com",
        receivingAddressId: "ra",
        routeOwnerMailboxId: "owner",
        routedAddressSnapshot: "a@test.com",
        routedAt: "2026-01-01T00:00:00.000Z",
        resolvedRouteMode: "fallback",
        resolvedFallbackMailboxId: "fallback",
      },
    });
    assert.equal(ackSafe, true);
  });

  it("pending fallback without frozen id is not ACK safe", () => {
    const ackSafe = isInboundRouteSnapshotAckSafe({
      providerEvent: {
        status: "pending",
        payloadStorageKey: "mail/raw-ingestion/x",
        payloadContentHash: "a".repeat(64),
        payloadSizeBytes: 10,
      },
      inboundChild: {
        id: "child",
        ingestionEventId: "evt",
        eventKind: "inbound_message",
        envelopeRecipientAddress: "a@test.com",
        receivingAddressId: "ra",
        routeOwnerMailboxId: "owner",
        routedAddressSnapshot: "a@test.com",
        routedAt: "2026-01-01T00:00:00.000Z",
        resolvedRouteMode: "fallback",
        resolvedFallbackMailboxId: null,
      },
    });
    assert.equal(ackSafe, false);
  });

  it("route decision reads frozen snapshot not live config", () => {
    assert.equal(
      routeDecisionFromSnapshot(
        {
          resolvedRouteMode: "fallback",
          resolvedFallbackMailboxId: "mailbox-a",
          receivingAddressId: "ra",
          routeOwnerMailboxId: "owner",
          routedAddressSnapshot: "a@test.com",
        },
        "pending",
      ),
      "fallback",
    );
  });
});
