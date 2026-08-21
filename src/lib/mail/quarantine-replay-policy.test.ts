import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DELIVERY_QUARANTINE_REASONS } from "@/lib/mail/delivery-quarantine-reasons";
import { INBOUND_QUARANTINE_REASONS } from "@/lib/mail/inbound-quarantine-reasons";
import {
  classifyDeliveryQuarantineReason,
  classifyInboundQuarantineReason,
  inboundReplayPreservesFrozenSnapshot,
  inboundReplayRequiresLiveRouteResolution,
  isDeliveryQuarantineReasonReplayable,
  isInboundQuarantineReasonReplayable,
} from "@/lib/mail/quarantine-replay-policy";

describe("quarantine replay policy", () => {
  it("classifies inbound routing quarantine as replayable", () => {
    assert.equal(
      classifyInboundQuarantineReason(
        INBOUND_QUARANTINE_REASONS.unknownReceivingAddress,
      ),
      "replayable_after_external_state_change",
    );
    assert.equal(
      classifyInboundQuarantineReason(
        INBOUND_QUARANTINE_REASONS.materializationTargetUnusable,
      ),
      "replayable_after_external_state_change",
    );
  });

  it("classifies inbound integrity quarantine as non-replayable", () => {
    assert.equal(
      classifyInboundQuarantineReason(
        INBOUND_QUARANTINE_REASONS.rfcMessageIdCollision,
      ),
      "non_replayable_integrity_failure",
    );
    assert.equal(
      classifyInboundQuarantineReason(
        INBOUND_QUARANTINE_REASONS.payloadIntegrityConflict,
      ),
      "non_replayable_integrity_failure",
    );
  });

  it("classifies delivery correlation dependency as replayable", () => {
    assert.ok(
      isDeliveryQuarantineReasonReplayable(
        DELIVERY_QUARANTINE_REASONS.correlationUnresolved,
      ),
    );
    assert.equal(
      classifyDeliveryQuarantineReason(
        DELIVERY_QUARANTINE_REASONS.missingProviderMessageId,
      ),
      "non_replayable_integrity_failure",
    );
  });

  it("requires live route resolution only when snapshot is null", () => {
    assert.equal(
      inboundReplayRequiresLiveRouteResolution(
        { resolvedRouteMode: null },
        INBOUND_QUARANTINE_REASONS.unknownReceivingAddress,
      ),
      true,
    );
    assert.equal(
      inboundReplayRequiresLiveRouteResolution(
        { resolvedRouteMode: "fallback" },
        INBOUND_QUARANTINE_REASONS.materializationTargetUnusable,
      ),
      false,
    );
    assert.ok(
      inboundReplayPreservesFrozenSnapshot({ resolvedRouteMode: "fallback" }),
    );
  });

  it("rejects unknown inbound reason codes", () => {
    assert.equal(
      classifyInboundQuarantineReason("made_up_reason"),
      "unknown_reason",
    );
    assert.equal(isInboundQuarantineReasonReplayable("made_up_reason"), false);
  });
});
