import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { handleGetAccessibleMailboxes } from "@/app/api/mail/mailboxes/accessible/route";
import { makeRequireMailActor } from "@/app/api/mail/mail-read-route-test-helpers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  resolveMailActorContext,
  type MailActorContext,
} from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { listComposeContextOptions } from "@/lib/mail/compose-context-service";
import { MailServiceError } from "@/lib/mail/errors";
import { listAccessibleMailboxes } from "@/lib/mail/mail-read-mailbox-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { grantMailboxMember } from "@/lib/mail/mailbox-member-service";
import { resolveEffectiveStateFromSnapshot } from "@/lib/mail/effective-mail-access-state";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "personal-mailbox-owner";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let fixtureSeq = 0;

function fixtureAddress(localPart: string): string {
  fixtureSeq += 1;
  return `${FIXTURE}-${fixtureSeq}-${randomUUID().slice(0, 8)}-${localPart}@echfronthk.com`;
}

function actor(
  userId: string,
  options: {
    crmRole?: "admin" | "staff";
    mailAccessEnabled?: boolean;
    adminGrants?: MailAdminPermission[];
    effectiveMailAccess?: MailActorContext["effectiveMailAccess"];
  } = {},
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole:
      options.crmRole ?? (userId === SEED_IDS.admin ? "admin" : "staff"),
    mailAccessEnabled: options.mailAccessEnabled ?? true,
    effectiveMailAccess: options.effectiveMailAccess,
    adminGrants: options.adminGrants ?? [],
    audit: { ipAddress: "127.0.0.1", userAgent: "personal-mailbox-owner-test" },
  };
}

const adminActor = actor(SEED_IDS.admin, {
  adminGrants: ["account_mgmt", "address_assignment"],
});

function rootAdminActor(): MailActorContext {
  return actor(SEED_IDS.admin, {
    mailAccessEnabled: false,
    adminGrants: [],
  });
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
  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);

  if (mailboxIds.length) {
    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));
    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(
        inArray(
          schema.mailSenderIdentityGrants.senderIdentityId,
          db
            .select({ id: schema.mailSenderIdentities.id })
            .from(schema.mailSenderIdentities)
            .where(inArray(schema.mailSenderIdentities.defaultMailboxId, mailboxIds)),
        ),
      );
    await db
      .delete(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.defaultMailboxId, mailboxIds));
    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, mailboxIds));
  }
}

describe("personal mailbox owner provisioning", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;

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
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("Root Admin creates personal mailbox for Staff target owner", async () => {
    const address = fixtureAddress("daniel");
    const created = await createMailbox(db, adminActor, {
      address,
      displayName: "Daniel.Hayes",
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });

    assert.equal(created.mailboxType, "personal");
    assert.equal(created.address, address.toLowerCase());
    assert.equal(created.createdBy, SEED_IDS.staffA);
    assert.notEqual(created.createdBy, SEED_IDS.admin);
    assert.ok(created.currentPrimary);
    assert.equal(created.currentPrimary?.address, address.toLowerCase());
    assert.equal(created.currentPrimary?.addressType, "primary");
    assert.equal(created.currentPrimary?.status, "active");

    const members = await db
      .select()
      .from(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.mailboxId, created.id));
    assert.equal(members.length, 1);
    assert.equal(members[0]?.userId, SEED_IDS.staffA);
    assert.equal(members[0]?.canRead, 1);
    assert.equal(members[0]?.canReply, 0);
    assert.equal(members[0]?.canSend, 0);

    const senderIdentities = await db
      .select()
      .from(schema.mailSenderIdentities)
      .where(eq(schema.mailSenderIdentities.defaultMailboxId, created.id));
    assert.equal(senderIdentities.length, 0);

    const composeOptions = await listComposeContextOptions(
      db,
      actor(SEED_IDS.staffA),
    );
    assert.ok(
      !composeOptions.some((option) => option.mailboxId === created.id),
      "personal mailbox creation must not auto-authorize compose From options",
    );
  });

  it("allows CRM root admin as personal mailbox owner without mail_user_access row", async () => {
    await db
      .delete(schema.mailUserAccess)
      .where(eq(schema.mailUserAccess.userId, SEED_IDS.admin));

    try {
      const address = fixtureAddress("darrell-admin");
      const created = await createMailbox(db, adminActor, {
        address,
        displayName: "DarrellKoo",
        mailboxType: "personal",
        ownerUserId: SEED_IDS.admin,
      });

      assert.equal(created.createdBy, SEED_IDS.admin);
      assert.equal(created.mailboxType, "personal");

      const senderIdentities = await db
        .select()
        .from(schema.mailSenderIdentities)
        .where(eq(schema.mailSenderIdentities.defaultMailboxId, created.id));
      assert.equal(senderIdentities.length, 0);

      const identityGrants = await db
        .select()
        .from(schema.mailSenderIdentityGrants)
        .where(
          inArray(
            schema.mailSenderIdentityGrants.senderIdentityId,
            db
              .select({ id: schema.mailSenderIdentities.id })
              .from(schema.mailSenderIdentities)
              .where(eq(schema.mailSenderIdentities.defaultMailboxId, created.id)),
          ),
        );
      assert.equal(identityGrants.length, 0);

      await assert.rejects(
        () => listComposeContextOptions(db, rootAdminActor()),
        (error: unknown) =>
          error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
      );

      const supervised = await listAccessibleMailboxes(db, rootAdminActor());
      const row = supervised.find((item) => item.id === created.id);
      assert.ok(row);
      assert.equal(row.permissions.canSend, false);
      assert.equal(row.permissions.canReply, false);
    } finally {
      await enableMailAccess(db, SEED_IDS.admin);
    }
  });

  it("target Staff sees personal mailbox via canonical membership", async () => {
    const address = fixtureAddress("staff-access");
    const created = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });

    const items = await listAccessibleMailboxes(db, actor(SEED_IDS.staffA));
    const row = items.find((item) => item.id === created.id);
    assert.ok(row);
    assert.equal(row.accessMode, "member");
    assert.equal(row.permissions.canRead, true);
    assert.equal(row.permissions.canReply, false);
    assert.equal(row.permissions.canSend, false);
  });

  it("unrelated Staff cannot see another personal mailbox", async () => {
    const address = fixtureAddress("private");
    const created = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });

    const items = await listAccessibleMailboxes(db, actor(SEED_IDS.staffB));
    assert.ok(!items.some((item) => item.id === created.id));
  });

  it("Root Admin sees personal mailbox via global_read without relying on membership", async () => {
    const address = fixtureAddress("root-supervision");
    const created = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });

    const res = await handleGetAccessibleMailboxes(
      new Request("http://localhost/api/mail/mailboxes/accessible"),
      { requireMailActor: makeRequireMailActor(db, rootAdminActor()) },
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      items: Array<{ id: string; accessMode: string }>;
    };
    const row = json.items.find((item) => item.id === created.id);
    assert.ok(row);
    assert.equal(row.accessMode, "global_read");
  });

  it("shared mailbox member flow remains unchanged", async () => {
    const address = fixtureAddress("shared");
    const created = await createMailbox(db, adminActor, {
      address,
      mailboxType: "shared",
    });
    assert.equal(created.createdBy, SEED_IDS.admin);

    const member = await grantMailboxMember(db, adminActor, {
      mailboxId: created.id,
      targetUserId: SEED_IDS.staffA,
      canRead: true,
      canReply: true,
      canSend: false,
    });
    assert.equal(member.canRead, true);
    assert.equal(member.canSend, false);
  });

  it("rejects duplicate personal address", async () => {
    const address = fixtureAddress("duplicate");
    await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });

    await assert.rejects(
      () =>
        createMailbox(db, adminActor, {
          address,
          mailboxType: "personal",
          ownerUserId: SEED_IDS.staffB,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );
  });

  it("rejects personal mailbox without ownerUserId", async () => {
    await assert.rejects(
      () =>
        createMailbox(db, adminActor, {
          address: fixtureAddress("missing-owner"),
          mailboxType: "personal",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("rejects ownerUserId on shared mailbox", async () => {
    await assert.rejects(
      () =>
        createMailbox(db, adminActor, {
          address: fixtureAddress("shared-owner"),
          mailboxType: "shared",
          ownerUserId: SEED_IDS.staffA,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("rejects unknown personal mailbox owner", async () => {
    await assert.rejects(
      () =>
        createMailbox(db, adminActor, {
          address: fixtureAddress("unknown-owner"),
          mailboxType: "personal",
          ownerUserId: randomUUID(),
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "NOT_FOUND",
    );
  });

  it("provisions Mail User Access for an active personal mailbox owner", async () => {
    const unprovisionedUserId = randomUUID();
    const now = new Date().toISOString();
    await db.insert(schema.users).values({
      id: unprovisionedUserId,
      email: `${FIXTURE}-unprovisioned@echfronthk.com`,
      displayName: "Unprovisioned Staff",
      passwordHash: "hash",
      role: "staff",
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const address = fixtureAddress("no-mail-access");
      const created = await createMailbox(db, adminActor, {
        address,
        mailboxType: "personal",
        ownerUserId: unprovisionedUserId,
      });

      assert.equal(created.createdBy, unprovisionedUserId);
      assert.equal(created.mailboxType, "personal");

      const [mailAccess] = await db
        .select()
        .from(schema.mailUserAccess)
        .where(eq(schema.mailUserAccess.userId, unprovisionedUserId));
      assert.equal(mailAccess?.isEnabled, 1);
      const [owner] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, unprovisionedUserId))
        .limit(1);
      assert.ok(owner);
      const resolvedActor = await resolveMailActorContext(owner, { db });
      assert.equal(
        resolvedActor.effectiveMailAccess?.effectiveState,
        "MAILBOX_ASSIGNED_NOTIFICATION_MISSING",
      );

      const senderIdentities = await db
        .select()
        .from(schema.mailSenderIdentities)
        .where(eq(schema.mailSenderIdentities.defaultMailboxId, created.id));
      assert.equal(senderIdentities.length, 0);

      const identityGrants = await db
        .select()
        .from(schema.mailSenderIdentityGrants)
        .where(
          inArray(
            schema.mailSenderIdentityGrants.senderIdentityId,
            db
              .select({ id: schema.mailSenderIdentities.id })
              .from(schema.mailSenderIdentities)
              .where(eq(schema.mailSenderIdentities.defaultMailboxId, created.id)),
          ),
        );
      assert.equal(identityGrants.length, 0);

      await assert.rejects(
        () =>
          listComposeContextOptions(
            db,
            actor(unprovisionedUserId, {
              mailAccessEnabled: true,
              effectiveMailAccess: resolveEffectiveStateFromSnapshot({
                userRole: "staff",
                mailboxState: "active",
                mailAccessEnabled: true,
                notificationIdentityState: "missing",
              }),
            }),
          ),
        (error: unknown) =>
          error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
      );

      await assert.rejects(
        () =>
          listAccessibleMailboxes(
            db,
            actor(unprovisionedUserId, {
              mailAccessEnabled: true,
              effectiveMailAccess: resolveEffectiveStateFromSnapshot({
                userRole: "staff",
                mailboxState: "active",
                mailAccessEnabled: true,
                notificationIdentityState: "missing",
              }),
            }),
          ),
        (error: unknown) =>
          error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
      );
    } finally {
      await db
        .delete(schema.mailReceivingAddresses)
        .where(
          inArray(
            schema.mailReceivingAddresses.mailboxId,
            db
              .select({ id: schema.mailMailboxes.id })
              .from(schema.mailMailboxes)
              .where(eq(schema.mailMailboxes.createdBy, unprovisionedUserId)),
          ),
        );
      await db
        .delete(schema.mailMailboxMembers)
        .where(
          inArray(
            schema.mailMailboxMembers.mailboxId,
            db
              .select({ id: schema.mailMailboxes.id })
              .from(schema.mailMailboxes)
              .where(eq(schema.mailMailboxes.createdBy, unprovisionedUserId)),
          ),
        );
      await db
        .delete(schema.mailMailboxes)
        .where(eq(schema.mailMailboxes.createdBy, unprovisionedUserId));
      await db
        .delete(schema.mailUserAccess)
        .where(eq(schema.mailUserAccess.userId, unprovisionedUserId));
      await db.delete(schema.users).where(eq(schema.users.id, unprovisionedUserId));
    }
  });

  it("rejects disabled personal mailbox owner", async () => {
    const disabledUserId = randomUUID();
    const now = new Date().toISOString();
    await db.insert(schema.users).values({
      id: disabledUserId,
      email: `${FIXTURE}-disabled@echfronthk.com`,
      displayName: "Disabled Staff",
      passwordHash: "hash",
      role: "staff",
      isActive: 0,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await assert.rejects(
        () =>
          createMailbox(db, adminActor, {
            address: fixtureAddress("disabled-owner"),
            mailboxType: "personal",
            ownerUserId: disabledUserId,
          }),
        (error: unknown) =>
          error instanceof MailServiceError && error.errorCode === "VALIDATION",
      );
    } finally {
      await db.delete(schema.users).where(eq(schema.users.id, disabledUserId));
    }
  });

  it("records provisioning actor separately in mailbox audit metadata", async () => {
    const address = fixtureAddress("audit");
    const created = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.mailboxCreated),
          eq(schema.auditLogs.entityId, created.id),
        ),
      );
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.userId, SEED_IDS.admin);
    const metadata = JSON.parse(audits[0]?.metadata ?? "{}") as {
      ownerUserId?: string;
      provisionedByUserId?: string;
      actorUserId?: string;
    };
    assert.equal(metadata.ownerUserId, SEED_IDS.staffA);
    assert.equal(metadata.provisionedByUserId, SEED_IDS.admin);
    assert.equal(metadata.actorUserId, SEED_IDS.admin);
  });
});
