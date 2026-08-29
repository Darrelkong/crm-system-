import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { assertCanComposeFromIdentityInMailbox } from "@/lib/mail/compose-authorization";
import { MailServiceError } from "@/lib/mail/errors";
import { createMailbox } from "@/lib/mail/mailbox-service";
import {
  grantSenderIdentityAccess,
  revokeSenderIdentityGrant,
} from "@/lib/mail/sender-identity-grant-service";
import { assertHasSenderIdentitySendGrant } from "@/lib/mail/sender-identity-send-auth";
import {
  createSenderIdentity,
  listSenderIdentitiesForAdmin,
  restoreSenderIdentity,
  suspendSenderIdentity,
} from "@/lib/mail/sender-identity-service";
import {
  activateSignatureVersion,
  createSignatureVersion,
  getEffectiveSignatureForAuthorizedSender,
} from "@/lib/mail/signature-service";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-phase2c4";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailAdminPermission[] = [
    "address_assignment",
    "signature_template",
  ],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: "admin",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c4-test" },
  };
}

const adminActor = actor(SEED_IDS.admin, [
  "account_mgmt",
  "address_assignment",
  "signature_template",
]);
const addressAssignActor = actor(SEED_IDS.admin, [
  "account_mgmt",
  "address_assignment",
]);
const superAdminActor = actor(SEED_IDS.admin, ["super_admin"]);
const readOnlyActor = actor(SEED_IDS.admin, ["global_mail_read"]);
const signatureAdmin = actor(SEED_IDS.admin, ["signature_template"]);

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

async function enableMailAccess(db: TestDb, userId: string) {
  const now = new Date().toISOString();
  await db
    .insert(schema.mailUserAccess)
    .values({
      userId,
      isEnabled: 1,
      enabledAt: now,
      enabledBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.mailUserAccess.userId,
      set: { isEnabled: 1, updatedAt: now },
    });
}

async function cleanupFixtures(db: TestDb) {
  const fixtureMailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%@echfronthk.com`));

  const mailboxIds = fixtureMailboxes.map((row) => row.id);

  if (mailboxIds.length > 0) {
    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));

    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, mailboxIds));
  }

  await db
    .delete(schema.mailMailboxMembers)
    .where(like(schema.mailMailboxMembers.id, `${FIXTURE}%`));

  const fixtureIdentities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(
      like(schema.mailSenderIdentities.address, `${FIXTURE}%@echfronthk.com`),
    );

  const reservedIdentities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(
      inArray(schema.mailSenderIdentities.address, [
        "support@echfronthk.com",
        "service@echfronthk.com",
      ]),
    );

  const identityIds = [
    ...fixtureIdentities.map((row) => row.id),
    ...reservedIdentities.map((row) => row.id),
  ];

  if (identityIds.length > 0) {
    const versionRows = await db
      .select({ id: schema.mailSignatureVersions.id })
      .from(schema.mailSignatureVersions)
      .where(inArray(schema.mailSignatureVersions.senderIdentityId, identityIds));
    const versionIds = versionRows.map((row) => row.id);
    if (versionIds.length > 0) {
      await db
        .delete(schema.mailSignatureVersionAssets)
        .where(
          inArray(schema.mailSignatureVersionAssets.signatureVersionId, versionIds),
        );
      await db
        .delete(schema.mailSignatureVersions)
        .where(inArray(schema.mailSignatureVersions.id, versionIds));
    }

    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(
        inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds),
      );
    await db
      .delete(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.id, identityIds));
  }

  await db
    .delete(schema.mailStoredFiles)
    .where(like(schema.mailStoredFiles.id, `${FIXTURE}%`));

  if (mailboxIds.length > 0) {
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, mailboxIds));
  }

  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.entityId, `${FIXTURE}%`));
}

describe("sender identity + signature integration", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await enableMailAccess(db, SEED_IDS.admin);
    await enableMailAccess(db, SEED_IDS.staffA);
    await enableMailAccess(db, SEED_IDS.staffB);
    await cleanupFixtures(db);
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
  });

  it("allows same-text receiving address and sender identity", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("staff-alpha");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
    });

    const senderIdentity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    assert.equal(senderIdentity.address, address);
    const receiving = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
    assert.ok(receiving.length >= 1);

    await cleanupFixtures(db);
  });

  it("rejects send without exact sender identity grant", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("send-auth");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    const staff = actor(SEED_IDS.staffA, []);
    await assert.rejects(
      () => assertHasSenderIdentitySendGrant(db, staff, identity.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("allows send with exact grant and rejects super_admin without grant", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("grant-send");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    const grant = await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identity.id,
      targetUserId: SEED_IDS.staffA,
      canSend: true,
    });
    assert.ok(grant.canSend);

    const staff = actor(SEED_IDS.staffA, []);
    const auth = await assertHasSenderIdentitySendGrant(db, staff, identity.id);
    assert.equal(auth.identity.id, identity.id);

    await assert.rejects(
      () => assertHasSenderIdentitySendGrant(db, superAdminActor, identity.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await revokeSenderIdentityGrant(db, adminActor, { grantId: grant.id });
    await assert.rejects(
      () => assertHasSenderIdentitySendGrant(db, staff, identity.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("isolates sender identity grants per identity", async () => {
    await cleanupFixtures(db);
    const mailboxA = await createMailbox(db, adminActor, {
      address: fixtureAddress("iso-a"),
      mailboxType: "personal",
    });
    const mailboxB = await createMailbox(db, adminActor, {
      address: fixtureAddress("iso-b"),
      mailboxType: "personal",
    });
    const identityA = await createSenderIdentity(db, adminActor, {
      address: fixtureAddress("iso-a"),
      defaultMailboxId: mailboxA.id,
    });
    const identityB = await createSenderIdentity(db, adminActor, {
      address: fixtureAddress("iso-b"),
      defaultMailboxId: mailboxB.id,
    });

    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identityA.id,
      targetUserId: SEED_IDS.staffA,
      canSend: true,
    });

    const staff = actor(SEED_IDS.staffA, []);
    await assertHasSenderIdentitySendGrant(db, staff, identityA.id);
    await assert.rejects(
      () => assertHasSenderIdentitySendGrant(db, staff, identityB.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("rejects send when sender identity is suspended", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("suspend-send");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
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

    const staff = actor(SEED_IDS.staffA, []);
    await assertHasSenderIdentitySendGrant(db, staff, identity.id);

    await suspendSenderIdentity(db, adminActor, identity.id);
    await assert.rejects(
      () => assertHasSenderIdentitySendGrant(db, staff, identity.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await restoreSenderIdentity(db, adminActor, identity.id);
    await assertHasSenderIdentitySendGrant(db, staff, identity.id);

    await cleanupFixtures(db);
  });

  it("does not grant send via mailbox membership alone", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("mbox-member");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "shared",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    const now = new Date().toISOString();
    await db.insert(schema.mailMailboxMembers).values({
      id: `${FIXTURE}-member`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: 1,
      canReply: 1,
      canSend: 1,
      canAssign: 0,
      canManageProcessing: 0,
      canAddInternalNote: 0,
      grantedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    const staff = actor(SEED_IDS.staffA, []);
    await assert.rejects(
      () => assertHasSenderIdentitySendGrant(db, staff, identity.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("identity grant helper passes without mailbox can_send (full send deferred)", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("mbox-grant-split");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "shared",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    const now = new Date().toISOString();
    await db.insert(schema.mailMailboxMembers).values({
      id: `${FIXTURE}-read-only-member`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: 1,
      canReply: 0,
      canSend: 0,
      canAssign: 0,
      canManageProcessing: 0,
      canAddInternalNote: 0,
      grantedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    await assert.rejects(
      () =>
        grantSenderIdentityAccess(db, adminActor, {
          senderIdentityId: identity.id,
          targetUserId: SEED_IDS.staffA,
          canSend: true,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );

    await db.insert(schema.mailSenderIdentityGrants).values({
      id: `${FIXTURE}-legacy-invalid-grant`,
      senderIdentityId: identity.id,
      userId: SEED_IDS.staffA,
      canReply: 0,
      canSend: 1,
      grantedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    const staff = actor(SEED_IDS.staffA, []);
    await assertHasSenderIdentitySendGrant(db, staff, identity.id);
    await assert.rejects(
      () =>
        assertCanComposeFromIdentityInMailbox(db, staff, {
          senderIdentityId: identity.id,
          mailboxId: mailbox.id,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("reserved system identities require super_admin not address_assignment", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("reserved-mbox"),
      mailboxType: "personal",
    });

    const normalIdentity = await createSenderIdentity(db, addressAssignActor, {
      address: fixtureAddress("normal-staff"),
      defaultMailboxId: mailbox.id,
    });
    assert.ok(normalIdentity.id);

    await assert.rejects(
      () =>
        createSenderIdentity(db, addressAssignActor, {
          address: "support@echfronthk.com",
          defaultMailboxId: mailbox.id,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await assert.rejects(
      () =>
        createSenderIdentity(db, addressAssignActor, {
          address: "noreply@echfronthk.com",
          defaultMailboxId: mailbox.id,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    const supportIdentity = await createSenderIdentity(db, superAdminActor, {
      address: "support@echfronthk.com",
      defaultMailboxId: mailbox.id,
    });
    assert.equal(supportIdentity.address, "support@echfronthk.com");

    const serviceIdentity = await createSenderIdentity(db, superAdminActor, {
      address: "service@echfronthk.com",
      defaultMailboxId: mailbox.id,
    });
    assert.equal(serviceIdentity.address, "service@echfronthk.com");

    const crmAdminNoMailGrant = actor(SEED_IDS.admin, []);
    crmAdminNoMailGrant.crmRole = "admin";
    await assert.rejects(
      () =>
        createSenderIdentity(db, crmAdminNoMailGrant, {
          address: "support@echfronthk.com",
          defaultMailboxId: mailbox.id,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("manages text-only signature versions without snapshots", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("sig-version");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    const v1 = await createSignatureVersion(db, signatureAdmin, {
      senderIdentityId: identity.id,
      bodyText: "Version 1 signature",
    });
    await activateSignatureVersion(db, signatureAdmin, v1.id);

    const v2 = await createSignatureVersion(db, signatureAdmin, {
      senderIdentityId: identity.id,
      bodyText: "Version 2 signature",
    });
    await activateSignatureVersion(db, signatureAdmin, v2.id);

    const versions = await db
      .select()
      .from(schema.mailSignatureVersions)
      .where(eq(schema.mailSignatureVersions.senderIdentityId, identity.id))
      .orderBy(schema.mailSignatureVersions.versionNumber);

    assert.equal(versions.length, 2);
    assert.equal(versions[0]?.bodyText, "Version 1 signature");
    assert.equal(versions[1]?.bodyText, "Version 2 signature");
    assert.equal(versions[1]?.isActive, 1);
    assert.equal(versions[0]?.isActive, 0);

    const snapshots = await db.select().from(schema.mailSignatureSnapshots);
    assert.equal(
      snapshots.filter((row) => row.senderIdentityId === identity.id).length,
      0,
    );

    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identity.id,
      targetUserId: SEED_IDS.staffA,
      canSend: true,
    });
    const effective = await getEffectiveSignatureForAuthorizedSender(
      db,
      actor(SEED_IDS.staffA, []),
      identity.id,
    );
    assert.equal(effective?.bodyText, "Version 2 signature");

    await assert.rejects(
      () =>
        createSignatureVersion(db, actor(SEED_IDS.staffA, []), {
          senderIdentityId: identity.id,
          bodyText: "Staff attempt",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("stores sanitized rich HTML without raw dangerous content", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("sig-html");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    const rawHtml =
      '<p style="color:#222222;font-size:14px;">Hello <strong>Team</strong></p><script>alert(1)</script>';
    const version = await createSignatureVersion(db, signatureAdmin, {
      senderIdentityId: identity.id,
      bodyText: "Hello Team",
      bodyHtml: rawHtml,
    });
    await activateSignatureVersion(db, signatureAdmin, version.id);

    const [stored] = await db
      .select()
      .from(schema.mailSignatureVersions)
      .where(eq(schema.mailSignatureVersions.id, version.id));

    assert.ok(stored?.bodyHtmlSanitized);
    assert.doesNotMatch(stored.bodyHtmlSanitized ?? "", /script/i);
    assert.doesNotMatch(stored.bodyHtmlSanitized ?? "", /alert\(1\)/);
    assert.notEqual(stored.bodyHtmlSanitized, rawHtml);

    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identity.id,
      targetUserId: SEED_IDS.staffA,
      canSend: true,
    });
    const effective = await getEffectiveSignatureForAuthorizedSender(
      db,
      actor(SEED_IDS.staffA, []),
      identity.id,
    );
    assert.match(effective?.bodyHtmlSanitized ?? "", /Team/);

    await cleanupFixtures(db);
  });

  it("rejects signature HTML that sanitizes to empty", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("sig-html");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    await assert.rejects(
      () =>
        createSignatureVersion(db, signatureAdmin, {
          senderIdentityId: identity.id,
          bodyText: "Safe text",
          bodyHtml: "<script>alert(1)</script>",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );

    await cleanupFixtures(db);
  });

  it("links valid stored image asset to signature version", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("sig-asset");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    const storedFileId = `${FIXTURE}-stored-file`;
    const contentHash = "a".repeat(64);
    const now = new Date().toISOString();
    await db.insert(schema.mailStoredFiles).values({
      id: storedFileId,
      contentHash,
      originalFilename: "logo.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      storageProvider: "r2",
      storageBucket: "mail-test",
      storageKey: `${FIXTURE}/logo.png`,
      securityScanStatus: "clean",
      securityScannedAt: now,
      createdAt: now,
    });

    const version = await createSignatureVersion(db, signatureAdmin, {
      senderIdentityId: identity.id,
      bodyText: "With logo",
      assets: [
        {
          storedFileId,
          contentHash,
          assetRef: "company-logo",
          mimeType: "image/png",
          sizeBytes: 1024,
        },
      ],
    });

    const assets = await db
      .select()
      .from(schema.mailSignatureVersionAssets)
      .where(eq(schema.mailSignatureVersionAssets.signatureVersionId, version.id));
    assert.equal(assets.length, 1);
    assert.equal(assets[0]?.assetRef, "company-logo");
    assert.ok(!JSON.stringify(assets).includes("storageKey"));

    await assert.rejects(
      () =>
        createSignatureVersion(db, signatureAdmin, {
          senderIdentityId: identity.id,
          bodyText: "Bad asset",
          assets: [
            {
              storedFileId: "missing",
              contentHash: "b".repeat(64),
              assetRef: "missing-logo",
              mimeType: "image/png",
              sizeBytes: 1,
            },
          ],
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "NOT_FOUND",
    );

    await cleanupFixtures(db);
  });

  it("denies global_mail_read for sender identity management", async () => {
    await assert.rejects(
      () => listSenderIdentitiesForAdmin(db, readOnlyActor),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });
});
