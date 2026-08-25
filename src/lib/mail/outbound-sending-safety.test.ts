import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertCanDispatchOutboundSend,
  hasCanDispatchOutboundSend,
} from "@/lib/mail/outbound-sending-permissions";
import {
  OUTBOUND_SEND_RATE_LIMIT_DEFAULTS,
  resolveOutboundSendRateLimitConfig,
  summarizeRateLimitPolicy,
} from "@/lib/mail/outbound-send-rate-limit";
import {
  isOutboundTransportDispatchAllowed,
  isTestOutboundTransportProvider,
  MAIL_OUTBOUND_TRANSPORT_ENABLED_VAR,
  MAIL_OUTBOUND_TRANSPORT_MODE_VAR,
  resolveMailOutboundTransportMode,
} from "@/lib/mail/outbound-transport-constants";

function actor(
  overrides: Partial<MailActorContext> = {},
): MailActorContext {
  return {
    userId: "user-1",
    sessionId: null,
    crmRole: "staff",
    mailAccessEnabled: true,
    adminGrants: [],
    audit: {},
    ...overrides,
  };
}

describe("outbound transport mode", () => {
  it("defaults to disabled when unset", () => {
    assert.equal(resolveMailOutboundTransportMode({}), "disabled");
    assert.equal(isOutboundTransportDispatchAllowed("disabled"), false);
    assert.equal(isOutboundTransportDispatchAllowed("proof_only"), false);
    assert.equal(isOutboundTransportDispatchAllowed("dry_run"), true);
    assert.equal(isOutboundTransportDispatchAllowed("production"), true);
  });

  it("reads explicit mode env and legacy boolean", () => {
    assert.equal(
      resolveMailOutboundTransportMode({
        [MAIL_OUTBOUND_TRANSPORT_MODE_VAR]: "dry_run",
      }),
      "dry_run",
    );
    assert.equal(
      resolveMailOutboundTransportMode({
        [MAIL_OUTBOUND_TRANSPORT_ENABLED_VAR]: "true",
      }),
      "production",
    );
  });

  it("allows test transport providers to bypass production gates", () => {
    assert.equal(isTestOutboundTransportProvider("fake-local"), true);
    assert.equal(isTestOutboundTransportProvider("cloudflare-email-sending-outbound"), false);
  });
});

describe("outbound sending permissions", () => {
  it("requires approval review to dispatch staff_approved sends", () => {
    assert.throws(
      () =>
        assertCanDispatchOutboundSend(actor(), {
          authorizationMode: "staff_approved",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
    assert.doesNotThrow(() =>
      assertCanDispatchOutboundSend(
        actor({ adminGrants: ["approval_review"] }),
        { authorizationMode: "staff_approved" },
      ),
    );
  });

  it("requires CRM admin to dispatch admin_direct sends", () => {
    assert.throws(
      () =>
        assertCanDispatchOutboundSend(actor({ crmRole: "staff" }), {
          authorizationMode: "admin_direct",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
    assert.doesNotThrow(() =>
      assertCanDispatchOutboundSend(actor({ crmRole: "admin" }), {
        authorizationMode: "admin_direct",
      }),
    );
  });

  it("exposes dispatch capability helper", () => {
    assert.equal(
      hasCanDispatchOutboundSend(actor({ adminGrants: ["approval_review"] }), {
        authorizationMode: "staff_approved",
      }),
      true,
    );
    assert.equal(
      hasCanDispatchOutboundSend(actor({ mailAccessEnabled: false }), {
        authorizationMode: "staff_approved",
      }),
      false,
    );
  });
});

describe("outbound send rate limit config", () => {
  it("uses safe defaults and env overrides", () => {
    assert.deepEqual(
      resolveOutboundSendRateLimitConfig({}),
      OUTBOUND_SEND_RATE_LIMIT_DEFAULTS,
    );
    const custom = resolveOutboundSendRateLimitConfig({
      MAIL_OUTBOUND_SEND_MAX_DISPATCHES_PER_USER_HOUR: "10",
      MAIL_OUTBOUND_SEND_MAX_INITIATED_PER_USER_HOUR: "20",
      MAIL_OUTBOUND_SEND_MAX_RECIPIENTS_PER_BATCH: "25",
    });
    assert.equal(custom.maxDispatchesPerUserPerHour, 10);
    assert.equal(custom.maxInitiatedPerUserPerHour, 20);
    assert.equal(custom.maxRecipientsPerBatch, 25);
    assert.match(summarizeRateLimitPolicy(custom), /dispatch≤10\/user\/hour/);
  });
});

describe("duplicate prevention wiring", () => {
  it("documents idempotent send initiation keys", async () => {
    const { buildApprovedSendIdempotencyKey } = await import(
      "@/lib/mail/send-operation-service"
    );
    assert.equal(
      buildApprovedSendIdempotencyKey("approval-1"),
      "mail:approval:approval-1:send",
    );
  });
});

describe("production sending safety audit actions", () => {
  it("defines preflight and transport audit actions", async () => {
    const { MAIL_AUDIT_ACTIONS } = await import("@/lib/mail/constants");
    assert.equal(MAIL_AUDIT_ACTIONS.sendPreflightBlocked, "mail.send.preflight_blocked");
    assert.equal(
      MAIL_AUDIT_ACTIONS.sendDispatchAuthorized,
      "mail.send.dispatch_authorized",
    );
    assert.equal(
      MAIL_AUDIT_ACTIONS.transportModeObserved,
      "mail.transport.mode_observed",
    );
    assert.equal(
      MAIL_AUDIT_ACTIONS.notificationProofEnqueued,
      "mail.notification.proof_enqueued",
    );
  });
});
