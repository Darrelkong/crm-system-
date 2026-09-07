import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema";
import { SEED_IDS } from "../src/lib/constants/seed-ids";
import { bindTestDatabase, releaseTestDatabase } from "../src/lib/db";
import { resolveMailActorContext } from "../src/lib/mail/actor-context";
import { assertEffectiveMailAccess } from "../src/lib/permissions/mail";
import { ensureIsolatedMailAuthorizationFixture } from "../src/lib/mail/test-fixtures/mail-authorization-fixture";
import type { MailActorContext } from "../src/lib/mail/actor-context";
import {
  approveRevision,
  submitRevisionForApproval,
} from "../src/lib/mail/outbound-approval-service";
import { createOutboundRevisionFromDraft } from "../src/lib/mail/outbound-revision-service";
import { addDraftRecipient, createDraft } from "../src/lib/mail/draft-service";
import { createMailbox } from "../src/lib/mail/mailbox-service";
import { grantSenderIdentityAccess } from "../src/lib/mail/sender-identity-grant-service";
import { createSenderIdentity } from "../src/lib/mail/sender-identity-service";
import {
  dispatchSendOperation,
  initiateStaffApprovedSend,
} from "../src/lib/mail/send-operation-service";
import { processOutboundBackgroundDispatchItem } from "../src/lib/mail/outbound-background-dispatch-service";
import { MAIL_OUTBOUND_TRANSPORT_MODE_VAR } from "../src/lib/mail/outbound-transport-constants";
import { FakeMailTransportAdapter } from "../src/lib/mail/transport/fake-mail-transport-adapter";

interface Env {
  DB: D1Database;
  MAIL_TEST_HARNESS_ENABLED?: string;
  NODE_ENV?: string;
}

const adminActor: MailActorContext = {
  userId: SEED_IDS.admin,
  sessionId: null,
  crmRole: "admin",
  mailAccessEnabled: true,
  adminGrants: ["account_mgmt", "address_assignment", "signature_template"],
  audit: { userAgent: "mail-test-runtime" },
};

const staffActor: MailActorContext = {
  userId: SEED_IDS.staffA,
  sessionId: null,
  crmRole: "staff",
  mailAccessEnabled: true,
  adminGrants: [],
  audit: { userAgent: "mail-test-runtime" },
};

const approvalReviewActor: MailActorContext = {
  userId: SEED_IDS.staffB,
  sessionId: null,
  crmRole: "staff",
  mailAccessEnabled: true,
  adminGrants: ["approval_review"],
  audit: { userAgent: "mail-test-runtime" },
};

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

const mailTestSendOperation = {
  async fetch(_request: Request, env: Env): Promise<Response> {
    if (
      env.NODE_ENV === "production" ||
      env.MAIL_TEST_HARNESS_ENABLED !== "true"
    ) {
      return notFound();
    }

    const db = drizzle(env.DB, { schema });
    bindTestDatabase(db);
    await ensureIsolatedMailAuthorizationFixture(db);
    const [staffUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.staffA))
      .limit(1);
    if (!staffUser) {
      throw new Error("Runtime Staff user is missing");
    }
    const resolvedStaff = await resolveMailActorContext(staffUser, { db });
    assertEffectiveMailAccess(resolvedStaff);

    const address = `mail-test-${crypto.randomUUID().slice(0, 8)}@echfronthk.com`;
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });
    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identity.id,
      targetUserId: SEED_IDS.staffA,
      canSend: true,
    });

    const draft = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Runtime Staff Send",
      bodyText: "Runtime Staff Send body",
    });
    if (!draft.created) {
      throw new Error("Runtime test draft was not created");
    }
    const withRecipient = await addDraftRecipient(db, staffActor, {
      draftId: draft.item.id,
      expectedAutosaveVersion: draft.item.autosaveVersion,
      recipientType: "to",
      address: "client@example.com",
    });
    const revision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: withRecipient.id,
      expectedAutosaveVersion: withRecipient.autosaveVersion,
    });
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });
    await approveRevision(db, approvalReviewActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });

    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: revision.id,
      idempotencyKey: `mail-test-runtime-${crypto.randomUUID()}`,
    });
    const mode = new URL(_request.url).searchParams.get("mode") ?? "direct";
    let dispatchedStatus: string;
    let providerAttemptState: string | null;
    let providerCallCount: number;
    if (mode === "background") {
      const result = await processOutboundBackgroundDispatchItem(db, {
        env: { [MAIL_OUTBOUND_TRANSPORT_MODE_VAR]: "dry_run" },
        db,
      }, initiated);
      dispatchedStatus = result;
      const [attempt] = await db
        .select()
        .from(schema.mailTransportAttempts)
        .where(eq(schema.mailTransportAttempts.sendOperationId, initiated.id))
        .limit(1);
      providerAttemptState = attempt?.state ?? null;
      providerCallCount = 1;
    } else {
      const adapter = new FakeMailTransportAdapter().setBehavior({
        outcome: "accepted",
        providerRequestId: "runtime-request-1",
        providerMessageId: "runtime-message-1",
      });
      const dispatched = await dispatchSendOperation(db, approvalReviewActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter,
      });
      dispatchedStatus = dispatched.status;
      providerAttemptState = dispatched.transportAttempts?.[0]?.state ?? null;
      providerCallCount = adapter.capture.callCount;
    }

    const [member] = await db
      .select()
      .from(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.mailboxId, mailbox.id))
      .limit(1);
    if (!member) {
      throw new Error("Runtime Mail fixture relationships are incomplete");
    }
    const [notificationIdentity] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, SEED_IDS.staffA))
      .limit(1);
    const [senderGrant] = await db
      .select()
      .from(schema.mailSenderIdentityGrants)
      .where(
        eq(schema.mailSenderIdentityGrants.senderIdentityId, identity.id),
      )
      .limit(1);

    const response = Response.json({
      authorizationMode: initiated.authorizationMode,
      initiatedStatus: initiated.status,
      dispatchedStatus,
      providerAttemptState,
      providerCallCount,
      mailboxId: mailbox.id,
      senderIdentityId: identity.id,
      staffId: staffUser.id,
      staffRole: staffUser.role,
      effectiveMailState: resolvedStaff.effectiveMailAccess?.effectiveState,
      mailboxMemberId: member.id,
      notificationIdentityVerified:
        notificationIdentity?.verificationStatus === "verified" &&
        notificationIdentity.revokedAt === null,
      senderGrantCanSend: senderGrant?.canSend === 1,
    });
    releaseTestDatabase(db);
    return response;
  },
};

export default mailTestSendOperation;
