import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertMailOutboundApprovalReview,
  hasMailOutboundApprovalReview,
} from "@/lib/permissions/mail";

function actor(
  grants: MailActorContext["adminGrants"],
  mailAccessEnabled = true,
): MailActorContext {
  return {
    userId: "user-1",
    sessionId: null,
    crmRole: "staff",
    mailAccessEnabled,
    adminGrants: grants,
    audit: {},
  };
}

describe("mail outbound approval review permissions (2C.6.2)", () => {
  it("allows approval_review grant", () => {
    const reviewActor = actor(["approval_review"]);
    assert.equal(hasMailOutboundApprovalReview(reviewActor), true);
    assert.doesNotThrow(() => assertMailOutboundApprovalReview(reviewActor));
  });

  it("allows super_admin grant", () => {
    const reviewActor = actor(["super_admin"]);
    assert.equal(hasMailOutboundApprovalReview(reviewActor), true);
    assert.doesNotThrow(() => assertMailOutboundApprovalReview(reviewActor));
  });

  it("rejects account_mgmt alone", () => {
    const accountActor = actor(["account_mgmt"]);
    assert.equal(hasMailOutboundApprovalReview(accountActor), false);
    assert.throws(
      () => assertMailOutboundApprovalReview(accountActor),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("rejects permission_mgmt alone", () => {
    const actorWithGrant = actor(["permission_mgmt"]);
    assert.equal(hasMailOutboundApprovalReview(actorWithGrant), false);
    assert.throws(
      () => assertMailOutboundApprovalReview(actorWithGrant),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("rejects address_assignment alone", () => {
    const actorWithGrant = actor(["address_assignment"]);
    assert.equal(hasMailOutboundApprovalReview(actorWithGrant), false);
  });

  it("rejects signature_template alone", () => {
    const actorWithGrant = actor(["signature_template"]);
    assert.equal(hasMailOutboundApprovalReview(actorWithGrant), false);
  });

  it("rejects global_mail_read alone", () => {
    const readActor = actor(["global_mail_read"]);
    assert.equal(hasMailOutboundApprovalReview(readActor), false);
    assert.throws(
      () => assertMailOutboundApprovalReview(readActor),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("rejects mail access disabled", () => {
    const disabledActor = actor(["approval_review"], false);
    assert.equal(hasMailOutboundApprovalReview(disabledActor), false);
  });

  it("rejects staff with no admin grants", () => {
    const staffActor = actor([]);
    assert.equal(hasMailOutboundApprovalReview(staffActor), false);
  });
});
