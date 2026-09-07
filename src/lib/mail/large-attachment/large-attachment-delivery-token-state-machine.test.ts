import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  transitionArmedToConfirmed,
  transitionArmedToExpired,
  transitionArmedToRevoked,
  transitionPreparedToArmed,
  type LargeAttachmentDeliveryTokenRecord,
} from "./large-attachment-delivery-token-state-machine";

const BASE: LargeAttachmentDeliveryTokenRecord = {
  id: "delivery-token-1",
  state: "prepared",
  tokenHash: "a".repeat(64),
  expiresAt: "2026-09-13T08:00:00.000Z",
  createdAt: "2026-09-06T08:00:00.000Z",
  armedAt: null,
  confirmedAt: null,
  revokedAt: null,
  providerMessageId: null,
  providerAcceptedAt: null,
};

describe("large attachment delivery-token state machine", () => {
  it("supports prepared → armed → confirmed", () => {
    const armed = transitionPreparedToArmed(BASE, "2026-09-06T08:00:01.000Z");
    assert.equal(armed.state, "armed");
    const confirmed = transitionArmedToConfirmed(armed, {
      confirmedAt: "2026-09-06T08:00:02.000Z",
      providerMessageId: "provider-message-1",
      providerAcceptedAt: "2026-09-06T08:00:02.000Z",
    });
    assert.equal(confirmed.state, "confirmed");
    assert.equal(confirmed.providerMessageId, "provider-message-1");
  });

  it("revokes prepared or armed tokens but never confirmed tokens", () => {
    const revoked = transitionArmedToRevoked(
      transitionPreparedToArmed(BASE, "2026-09-06T08:00:01.000Z"),
      "2026-09-06T08:00:02.000Z",
    );
    assert.equal(revoked.state, "revoked");
    assert.throws(() =>
      transitionArmedToRevoked(
        transitionArmedToConfirmed(
          transitionPreparedToArmed(BASE, "2026-09-06T08:00:01.000Z"),
          {
            confirmedAt: "2026-09-06T08:00:02.000Z",
            providerMessageId: "provider-message-1",
            providerAcceptedAt: "2026-09-06T08:00:02.000Z",
          },
        ),
        "2026-09-06T08:00:03.000Z",
      ),
    );
  });

  it("expires armed and confirmed capabilities without extending retention", () => {
    const armed = transitionPreparedToArmed(BASE, "2026-09-06T08:00:01.000Z");
    assert.equal(transitionArmedToExpired(armed).state, "expired");
    assert.equal(
      transitionArmedToExpired(
        transitionArmedToConfirmed(armed, {
          confirmedAt: "2026-09-06T08:00:02.000Z",
          providerMessageId: "provider-message-1",
          providerAcceptedAt: "2026-09-06T08:00:02.000Z",
        }),
      ).state,
      "expired",
    );
  });
});
