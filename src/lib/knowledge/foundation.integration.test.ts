import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { createSession, validateSessionToken } from "@/lib/auth/session";
import {
  bootstrapKnowledge,
  changeKnowledgePassword,
  getKnowledgePolicy,
} from "@/lib/knowledge/access-policy-service";
import {
  getKnowledgeAccessStatus,
  lockKnowledgeSession,
  verifyKnowledgePassword,
} from "@/lib/knowledge/unlock-service";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  getKnowledgeRole,
  setKnowledgeRole,
} from "@/lib/knowledge/role-service";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

const PASSWORD = "KnowledgePass1";
const NEXT_PASSWORD = "KnowledgePass2";
const FAKE_DEVICE = "knowledge-foundation-test-device";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;

async function cleanupKnowledge(): Promise<void> {
  await db.delete(schema.knowledgeSessionUnlocks);
  await db.delete(schema.knowledgeUserRoles);
  await db.delete(schema.knowledgeAccessPolicy);
  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.action, "knowledge.%"));
  await db
    .delete(schema.sessions)
    .where(inArray(schema.sessions.userId, [SEED_IDS.admin, SEED_IDS.staffA]));
}

async function createTestSession(userId: string) {
  return createSession(
    userId,
    new Request("https://knowledge.test/", {
      headers: { "user-agent": "knowledge-foundation-test" },
    }),
    FAKE_DEVICE,
  );
}

async function assertServiceError(
  action: () => Promise<unknown>,
  errorCode: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof KnowledgeServiceError);
    assert.equal(error.errorCode, errorCode);
    return true;
  });
}

describe("Knowledge foundation — disposable D1", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);

    adminUser = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, SEED_IDS.admin))
        .limit(1)
    )[0] as User;
    staffUser = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, SEED_IDS.staffA))
        .limit(1)
    )[0] as User;

    await cleanupKnowledge();
  });

  after(async () => {
    await cleanupKnowledge();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("creates the three foundation tables without customer coupling", async () => {
    const tables = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name IN (
              'knowledge_access_policy',
              'knowledge_session_unlocks',
              'knowledge_user_roles'
            )`,
    );
    assert.deepEqual(
      tables.map((row) => row.name).sort(),
      [
        "knowledge_access_policy",
        "knowledge_session_unlocks",
        "knowledge_user_roles",
      ],
    );

    const migration = await db.all<{ name: string }>(
      sql`SELECT name FROM d1_migrations WHERE name = '0076_knowledge_foundation.sql'`,
    );
    assert.equal(migration.length, 1);

    const tableSql = await db.all<{ name: string; sql: string }>(
      sql`SELECT name, sql FROM sqlite_master
          WHERE name IN (
            'knowledge_access_policy',
            'knowledge_session_unlocks',
            'knowledge_user_roles'
          )`,
    );
    assert.ok(tableSql.every((row) => !row.sql.includes("customer_id")));

    const foreignKeys = await db.all(sql`PRAGMA foreign_key_check`);
    const quickCheck = await db.all<{ quick_check: string }>(
      sql`PRAGMA quick_check`,
    );
    assert.equal(foreignKeys.length, 0);
    assert.equal(quickCheck[0]?.quick_check, "ok");
  });

  it("rejects staff bootstrap and atomically bootstraps the CRM admin", async () => {
    const staffSession = await createTestSession(staffUser.id);
    await assertServiceError(
      () =>
        bootstrapKnowledge(
          staffUser,
          PASSWORD,
          staffSession.sessionId,
          {},
          db,
        ),
      "KNOWLEDGE_ADMIN_REQUIRED",
    );
    assert.equal(await getKnowledgePolicy(db), null);

    const adminSession = await createTestSession(adminUser.id);
    await bootstrapKnowledge(
      adminUser,
      PASSWORD,
      adminSession.sessionId,
      {},
      db,
    );
    assert.equal(await getKnowledgeRole(adminUser.id, db), "knowledge_admin");
    const policy = await getKnowledgePolicy(db);
    assert.equal(policy?.passwordVersion, 1);
    assert.ok(policy?.passwordHash);

    const status = await getKnowledgeAccessStatus(
      adminSession.sessionId,
      adminUser.id,
      "knowledge_admin",
      db,
    );
    assert.equal(status.unlocked, true);
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "knowledge.bootstrap"));
    assert.equal(audits.length, 1);
  });

  it("allows one bootstrap only", async () => {
    const session = await createTestSession(adminUser.id);
    await assertServiceError(
      () =>
        bootstrapKnowledge(
          adminUser,
          PASSWORD,
          session.sessionId,
          {},
          db,
        ),
      "KNOWLEDGE_ALREADY_INITIALIZED",
    );
  });

  it("locks Knowledge after five failures without revoking CRM", async () => {
    const session = await createTestSession(adminUser.id);
    await lockKnowledgeSession(session.sessionId, adminUser.id, {}, db);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await assertServiceError(
        () =>
          verifyKnowledgePassword(
            session.sessionId,
            adminUser.id,
            "knowledge_admin",
            "WrongKnowledgePass1",
            {},
            db,
          ),
        "KNOWLEDGE_PASSWORD_INVALID",
      );
    }
    await assertServiceError(
      () =>
        verifyKnowledgePassword(
          session.sessionId,
          adminUser.id,
          "knowledge_admin",
          "WrongKnowledgePass1",
          {},
          db,
        ),
      "KNOWLEDGE_PASSWORD_LOCKED",
    );

    const unlock = (
      await db
        .select()
        .from(schema.knowledgeSessionUnlocks)
        .where(eq(schema.knowledgeSessionUnlocks.sessionId, session.sessionId))
    )[0];
    assert.equal(unlock?.failedAttempts, 5);
    assert.ok(unlock?.lockedUntil);

    const crmSession = await validateSessionToken(session.token, {
      touch: false,
    });
    assert.equal(crmSession.ok, true);
  });

  it("resets failures on success and invalidates old unlocks on password change", async () => {
    const session = await createTestSession(adminUser.id);
    await db
      .update(schema.knowledgeSessionUnlocks)
      .set({ lockedUntil: new Date(Date.now() - 1_000).toISOString() })
      .where(eq(schema.knowledgeSessionUnlocks.sessionId, session.sessionId));

    await verifyKnowledgePassword(
      session.sessionId,
      adminUser.id,
      "knowledge_admin",
      PASSWORD,
      {},
      db,
    );
    let status = await getKnowledgeAccessStatus(
      session.sessionId,
      adminUser.id,
      "knowledge_admin",
      db,
    );
    assert.equal(status.unlocked, true);

    await changeKnowledgePassword(adminUser, NEXT_PASSWORD, {}, db);
    status = await getKnowledgeAccessStatus(
      session.sessionId,
      adminUser.id,
      "knowledge_admin",
      db,
    );
    assert.equal(status.unlocked, false);
    assert.equal((await getKnowledgePolicy(db))?.passwordVersion, 2);
  });

  it("protects the sole Knowledge Admin and wrong session binding", async () => {
    const adminSession = await createTestSession(adminUser.id);
    await assertServiceError(
      () =>
        setKnowledgeRole(adminUser, adminUser.id, "viewer", {}, db),
      "KNOWLEDGE_LAST_ADMIN",
    );

    const wrongSession = await createTestSession(staffUser.id);
    const status = await getKnowledgeAccessStatus(
      wrongSession.sessionId,
      staffUser.id,
      null,
      db,
    );
    assert.equal(status.unlocked, false);
    assert.notEqual(wrongSession.sessionId, adminSession.sessionId);
  });

  it("uses one role per user and keeps role changes auditable", async () => {
    await setKnowledgeRole(adminUser, staffUser.id, "reviewer", {}, db);
    assert.equal(await getKnowledgeRole(staffUser.id, db), "reviewer");
    await setKnowledgeRole(adminUser, staffUser.id, "viewer", {}, db);
    assert.equal(await getKnowledgeRole(staffUser.id, db), "viewer");

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "knowledge.role_change"));
    assert.equal(audits.length, 2);
    assert.ok(audits.every((audit) => !audit.metadata?.includes("password")));
  });
});
