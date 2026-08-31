import { eq } from "drizzle-orm";
import type { MailOutboundRevision } from "../../../drizzle/schema/mail-outbound-revisions";
import type { MailSendOperation } from "../../../drizzle/schema/mail-send-operations";
import { schema, type Database } from "@/lib/db";
import {
  resolveMailActorContext,
  type MailActorContext,
} from "@/lib/mail/actor-context";
import {
  isSystemMailActor,
  type MailOperationalActor,
} from "@/lib/mail/system-mail-actor";
import { assertCanComposeFromIdentityInMailbox } from "@/lib/mail/compose-authorization";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import { buildSendOperationDirectAuditInsert, runMailBatch } from "@/lib/mail/guarded-batch";
import {
  normalizeOutboundRecipients,
  type OutboundRecipientInput,
} from "@/lib/mail/outbound-recipient-validation";
import { assertCanDispatchOutboundSend } from "@/lib/mail/outbound-sending-permissions";
import { assertOutboundSendRateLimitsWithinPolicy } from "@/lib/mail/outbound-send-rate-limit";
import {
  CLOUDFLARE_EMAIL_OUTBOUND_PROVIDER_ID,
  isOutboundTransportDispatchAllowed,
  isTestOutboundTransportProvider,
  type MailOutboundTransportMode,
} from "@/lib/mail/outbound-transport-constants";
import { assertStoredFilesEligibleForSend } from "@/lib/mail/stored-file-send-eligibility";
import { assertOrdinaryEmailAttachmentAggregateWithinLimit } from "@/lib/mail/outbound-provider-size-preflight";
import { assertRevisionHasNoLargeAttachmentsPendingGateway } from "@/lib/mail/large-attachment/large-attachment-provider-send-guard";
import { assertEffectiveMailAccess, assertMailAccessEnabled } from "@/lib/permissions/mail";

export type OutboundSendPreflightInput = {
  db: Database;
  actor: MailOperationalActor;
  send: MailSendOperation;
  revision: MailOutboundRevision;
  adapterProviderId: string;
  transportMode: MailOutboundTransportMode;
};

export type OutboundSendPreflightBlockReason = {
  code: string;
  message: string;
};

async function loadApprovedApprovalForRevision(
  db: Database,
  revision: MailOutboundRevision,
): Promise<void> {
  const [approval] = await db
    .select()
    .from(schema.mailOutboundApprovals)
    .where(
      eq(schema.mailOutboundApprovals.revisionChainId, revision.revisionChainId),
    )
    .limit(1);

  if (!approval) {
    throw MailServiceError.notFound("Approval workflow not found");
  }
  if (approval.status !== "approved") {
    throw MailServiceError.forbidden("Approval is not approved");
  }
  if (approval.approvedRevisionId !== revision.id) {
    throw MailServiceError.forbidden(
      "Send requires the exact approved revision — not a different revision in the chain",
    );
  }
  if (
    approval.approvedContentHash !== revision.contentHash ||
    approval.approvedHashVersion !== revision.hashVersion
  ) {
    throw MailServiceError.integrityConflict(
      "Approval provenance does not match revision hash",
    );
  }
}

async function assertRevisionHashIntegrity(
  db: Database,
  revision: MailOutboundRevision,
): Promise<void> {
  const [stored] = await db
    .select({
      contentHash: schema.mailOutboundRevisions.contentHash,
      hashVersion: schema.mailOutboundRevisions.hashVersion,
    })
    .from(schema.mailOutboundRevisions)
    .where(eq(schema.mailOutboundRevisions.id, revision.id))
    .limit(1);

  if (!stored) {
    throw MailServiceError.notFound("Outbound revision not found");
  }
  if (
    stored.contentHash !== revision.contentHash ||
    stored.hashVersion !== revision.hashVersion
  ) {
    throw MailServiceError.integrityConflict(
      "Outbound revision content hash integrity conflict",
    );
  }
}

async function resolveActorForUserId(
  db: Database,
  userId: string,
  audit: MailActorContext["audit"] = {},
): Promise<MailActorContext> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) {
    throw MailServiceError.notFound("User not found");
  }
  return resolveMailActorContext(user, { db, audit });
}

async function assertStaffAuthorSendAuthority(
  db: Database,
  revision: MailOutboundRevision,
  audit: MailActorContext["audit"],
): Promise<void> {
  const staffAuthor = await resolveActorForUserId(
    db,
    revision.createdByUserId,
    audit,
  );
  assertMailAccessEnabled(staffAuthor);
  await assertCanComposeFromIdentityInMailbox(db, staffAuthor, {
    senderIdentityId: revision.senderIdentityId,
    mailboxId: revision.mailboxId,
  });
}

async function assertAdminDirectSendAuthority(
  db: Database,
  actor: MailOperationalActor,
  revision: MailOutboundRevision,
): Promise<void> {
  if (isSystemMailActor(actor)) {
    return;
  }
  if (actor.crmRole !== "admin") {
    throw MailServiceError.forbidden("CRM admin role required for admin_direct send");
  }
  assertMailAccessEnabled(actor);
  await assertCanComposeFromIdentityInMailbox(db, actor, {
    senderIdentityId: revision.senderIdentityId,
    mailboxId: revision.mailboxId,
  });
}

async function assertRevisionRecipientsValid(
  db: Database,
  revisionId: string,
): Promise<number> {
  const recipients = await db
    .select()
    .from(schema.mailOutboundRevisionRecipients)
    .where(eq(schema.mailOutboundRevisionRecipients.revisionId, revisionId))
    .orderBy(schema.mailOutboundRevisionRecipients.sortOrder);

  const inputs: OutboundRecipientInput[] = recipients.map((recipient) => ({
    recipientType: recipient.recipientType,
    address: recipient.address,
    displayName: recipient.displayName,
    sortOrder: recipient.sortOrder,
  }));

  normalizeOutboundRecipients(inputs);
  return inputs.length;
}

function assertTransportModeAllowsDispatch(input: {
  transportMode: MailOutboundTransportMode;
  adapterProviderId: string;
}): void {
  if (isTestOutboundTransportProvider(input.adapterProviderId)) {
    return;
  }

  if (input.adapterProviderId !== CLOUDFLARE_EMAIL_OUTBOUND_PROVIDER_ID) {
    return;
  }

  if (input.transportMode === "proof_only") {
    throw MailServiceError.forbidden(
      "Outbound business-mail dispatch is blocked in proof_only transport mode — use notification proof enqueue instead",
    );
  }

  if (!isOutboundTransportDispatchAllowed(input.transportMode)) {
    throw MailServiceError.forbidden(
      `Outbound transport mode "${input.transportMode}" blocks business-mail dispatch`,
    );
  }
}

export async function assertRevisionOrdinaryEmailAttachmentsWithinPolicy(
  db: Database,
  revisionId: string,
): Promise<void> {
  const attachments = await db
    .select({
      sizeBytes: schema.mailOutboundRevisionAttachments.sizeBytes,
      deliveryMode: schema.mailOutboundRevisionAttachments.deliveryMode,
    })
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, revisionId));

  try {
    assertOrdinaryEmailAttachmentAggregateWithinLimit({ attachments });
  } catch {
    throw MailServiceError.validation(
      "Ordinary email attachments exceed provider-safe aggregate limit — remove attachments or use Secure File delivery",
      { revisionId },
    );
  }
}

export async function recordOutboundSendPreflightBlocked(
  db: Database,
  actor: MailOperationalActor,
  send: MailSendOperation,
  error: unknown,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date().toISOString();
  const reason =
    error instanceof MailServiceError
      ? { code: error.errorCode, message: error.message }
      : {
          code: "UNKNOWN",
          message: error instanceof Error ? error.message : "Preflight blocked",
        };

  await runMailBatch(db, [
    buildSendOperationDirectAuditInsert(db, actor, {
      auditId: crypto.randomUUID(),
      now,
      action: MAIL_AUDIT_ACTIONS.sendPreflightBlocked,
      sendOperationId: send.id,
      metadata: {
        outboundRevisionId: send.outboundRevisionId,
        authorizationMode: send.authorizationMode,
        reason,
        ...metadata,
      },
    }),
  ]);
}

export async function recordOutboundSendDispatchAuthorized(
  db: Database,
  actor: MailOperationalActor,
  send: MailSendOperation,
  metadata: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  await runMailBatch(db, [
    buildSendOperationDirectAuditInsert(db, actor, {
      auditId: crypto.randomUUID(),
      now,
      action: MAIL_AUDIT_ACTIONS.sendDispatchAuthorized,
      sendOperationId: send.id,
      metadata: {
        outboundRevisionId: send.outboundRevisionId,
        authorizationMode: send.authorizationMode,
        ...metadata,
      },
    }),
  ]);
}

/**
 * Unified outbound send preflight — runs before transport dispatch.
 * Does NOT invoke Cloudflare Email Sending or EMAIL binding.
 */
export async function assertOutboundSendPreflight(
  input: OutboundSendPreflightInput,
): Promise<void> {
  const { db, actor, send, revision, adapterProviderId, transportMode } =
    input;

  assertCanDispatchOutboundSend(actor, send);
  assertTransportModeAllowsDispatch({ transportMode, adapterProviderId });

  await assertRevisionHashIntegrity(db, revision);
  await assertStoredFilesEligibleForSend(db, revision.id);
  await assertRevisionOrdinaryEmailAttachmentsWithinPolicy(db, revision.id);
  await assertRevisionHasNoLargeAttachmentsPendingGateway(db, revision.id);

  if (send.authorizationMode === "staff_approved") {
    await loadApprovedApprovalForRevision(db, revision);
    await assertStaffAuthorSendAuthority(db, revision, actor.audit);
  } else {
    await assertAdminDirectSendAuthority(db, actor, revision);
  }

  const recipientCount = await assertRevisionRecipientsValid(db, revision.id);

  if (!isSystemMailActor(actor)) {
    await assertOutboundSendRateLimitsWithinPolicy(db, actor, {
      phase: "dispatch",
      recipientCount,
    });
  }
}

export async function runOutboundSendPreflightOrRecordBlock(
  input: OutboundSendPreflightInput,
): Promise<void> {
  try {
    await assertOutboundSendPreflight(input);
  } catch (error) {
    await recordOutboundSendPreflightBlocked(input.db, input.actor, input.send, error, {
      transportMode: input.transportMode,
      adapterProviderId: input.adapterProviderId,
    });
    throw error;
  }

  await recordOutboundSendDispatchAuthorized(input.db, input.actor, input.send, {
    transportMode: input.transportMode,
    adapterProviderId: input.adapterProviderId,
  });
}
