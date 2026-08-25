import type { MailSendOperation } from "../../../drizzle/schema/mail-send-operations";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertEffectiveMailAccess,
  assertMailOutboundApprovalReview,
  hasMailOutboundApprovalReview,
} from "@/lib/permissions/mail";

/**
 * Outbound sending permission model (Phase 2F-5):
 *
 * | Action   | Who | Requirement |
 * |----------|-----|-------------|
 * | Submit   | Staff author | Mail access + compose-from identity/mailbox grants |
 * | Approve  | Reviewer | `approval_review` or `super_admin` (not self-review) |
 * | Dispatch | Reviewer (staff_approved) or CRM admin (admin_direct) | See assertCanDispatchOutboundSend |
 *
 * Submit checks live in draft/revision/approval services via compose authorization.
 * Approve checks live in outbound-approval-service via assertMailOutboundApprovalReview.
 */

export function assertCanDispatchOutboundSend(
  actor: MailActorContext,
  send: Pick<MailSendOperation, "authorizationMode">,
): void {
  assertEffectiveMailAccess(actor);

  if (send.authorizationMode === "staff_approved") {
    assertMailOutboundApprovalReview(actor);
    return;
  }

  if (send.authorizationMode === "admin_direct") {
    if (actor.crmRole !== "admin") {
      throw MailServiceError.forbidden(
        "CRM admin role required to dispatch admin_direct send",
      );
    }
    return;
  }

  throw MailServiceError.forbidden("Unsupported send authorization mode");
}

export function hasCanDispatchOutboundSend(
  actor: MailActorContext,
  send: Pick<MailSendOperation, "authorizationMode">,
): boolean {
  if (!actor.mailAccessEnabled) {
    return false;
  }
  if (send.authorizationMode === "staff_approved") {
    return hasMailOutboundApprovalReview(actor);
  }
  if (send.authorizationMode === "admin_direct") {
    return actor.crmRole === "admin";
  }
  return false;
}
