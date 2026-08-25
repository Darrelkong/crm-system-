import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deliveryWebhookProviderSecretVar,
  MAIL_DELIVERY_WEBHOOK_SECRET_VAR,
  resolveDeliveryWebhookSecret,
} from "@/lib/mail/delivery-webhook-env";

describe("delivery webhook secret resolution", () => {
  it("reads shared secret from environment binding", () => {
    assert.equal(
      resolveDeliveryWebhookSecret({
        [MAIL_DELIVERY_WEBHOOK_SECRET_VAR]: "shared-secret",
      }),
      "shared-secret",
    );
  });

  it("prefers provider-specific secret override", () => {
    const providerVar = deliveryWebhookProviderSecretVar("fake-local");
    assert.equal(
      resolveDeliveryWebhookSecret(
        {
          [MAIL_DELIVERY_WEBHOOK_SECRET_VAR]: "shared-secret",
          [providerVar]: "provider-secret",
        },
        "fake-local",
      ),
      "provider-secret",
    );
  });

  it("returns null when secret is not configured", () => {
    assert.equal(resolveDeliveryWebhookSecret({}), null);
  });
});
