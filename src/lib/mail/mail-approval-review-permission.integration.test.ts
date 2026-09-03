import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  grantMailAdminPermission,
  revokeMailAdminGrant,
} from "@/lib/mail/mail-admin-grant-service";

const FIXTURE = "mail-phase2c62-grant";
const NOW = "2026-08-20T12:00:00.000Z";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailActorContext["adminGrants"],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c62-test" },
  };
}

const permissionMgmtActor = actor(SEED_IDS.admin, ["permission_mgmt"]);
const superAdminActor = actor(SEED_IDS.admin, ["super_admin"]);

async function enableMailAccess(db: TestDb, userId: string) {
  await db
    .insert(schema.mailUserAccess)
    .values({
      userId,
      isEnabled: 1,
      enabledAt: NOW,
      enabledBy: SEED_IDS.admin,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .onConflictDoUpdate({
      target: schema.mailUserAccess.userId,
      set: { isEnabled: 1, updatedAt: NOW },
    });
}

async function cleanupFixtureGrants(db: TestDb) {
  await db
    .delete(schema.mailAdminGrants)
    .where(eq(schema.mailAdminGrants.id, `${FIXTURE}-active-account`));
  await db
    .delete(schema.mailAdminGrants)
    .where(eq(schema.mailAdminGrants.id, `${FIXTURE}-revoked`));
  await db
    .delete(schema.mailAdminGrants)
    .where(eq(schema.mailAdminGrants.id, `${FIXTURE}-approval-review`));
  await db
    .delete(schema.mailAdminGrants)
    .where(eq(schema.mailAdminGrants.id, `${FIXTURE}-approval-review-2`));
}

describe("0062 approval_review permission Local D1 runtime", () => {
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
    await cleanupFixtureGrants(db);
  });

  after(async () => {
    await cleanupFixtureGrants(db);
    dispose?.();
  });

  it("schema accepts approval_review and rejects unknown permission", async () => {
    const grant = await grantMailAdminPermission(db, superAdminActor, {
      targetUserId: SEED_IDS.staffA,
      permission: "approval_review",
    });
    assert.equal(grant.permission, "approval_review");

    await assert.rejects(
      () =>
        db.insert(schema.mailAdminGrants).values({
          id: `${FIXTURE}-invalid`,
          userId: SEED_IDS.staffA,
          permission: "definitely_not_a_permission" as "approval_review",
          grantedAt: NOW,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      (error: unknown) => {
        const message =
          error instanceof Error
            ? `${error.message}${
                error.cause instanceof Error ? error.cause.message : ""
              }`
            : String(error);
        return /CHECK|constraint|SQLITE_CONSTRAINT/i.test(message);
      },
    );

    await revokeMailAdminGrant(db, superAdminActor, { grantId: grant.id });
  });

  it("preserves active/revoked grant lifecycle for approval_review", async () => {
    const revokedId = `${FIXTURE}-revoked`;

    await db.insert(schema.mailAdminGrants).values({
      id: revokedId,
      userId: SEED_IDS.staffA,
      permission: "approval_review",
      grantedBy: SEED_IDS.admin,
      grantedAt: NOW,
      revokedAt: NOW,
      revokedBy: SEED_IDS.admin,
      revokeReason: "fixture",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const first = await grantMailAdminPermission(db, permissionMgmtActor, {
      targetUserId: SEED_IDS.staffA,
      permission: "approval_review",
    });
    assert.equal(first.permission, "approval_review");

    const duplicate = await grantMailAdminPermission(db, permissionMgmtActor, {
      targetUserId: SEED_IDS.staffA,
      permission: "approval_review",
    });
    assert.equal(duplicate.id, first.id);

    await revokeMailAdminGrant(db, permissionMgmtActor, { grantId: first.id });

    const second = await grantMailAdminPermission(db, permissionMgmtActor, {
      targetUserId: SEED_IDS.staffA,
      permission: "approval_review",
    });
    assert.notEqual(second.id, first.id);
    assert.equal(second.revokedAt, null);

    const [revokedRow] = await db
      .select()
      .from(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.id, revokedId));
    assert.equal(revokedRow?.revokedAt, NOW);

    await revokeMailAdminGrant(db, permissionMgmtActor, { grantId: second.id });
  });

  it("CRM root admin can grant approval_review regardless of grant label", async () => {
    const accountMgmtActor = actor(SEED_IDS.admin, ["account_mgmt"]);
    const grant = await grantMailAdminPermission(db, accountMgmtActor, {
      targetUserId: SEED_IDS.staffA,
      permission: "approval_review",
    });
    assert.equal(grant.permission, "approval_review");
    await revokeMailAdminGrant(db, accountMgmtActor, { grantId: grant.id });
  });

  it("existing permissions still accepted after 0062", async () => {
    const grant = await grantMailAdminPermission(db, permissionMgmtActor, {
      targetUserId: SEED_IDS.staffA,
      permission: "global_mail_read",
    });
    assert.equal(grant.permission, "global_mail_read");
    await revokeMailAdminGrant(db, permissionMgmtActor, { grantId: grant.id });
  });
});
