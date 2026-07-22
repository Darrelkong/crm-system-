import assert from "node:assert/strict";
import { after, before, describe, it, type TestContext } from "node:test";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import {
  QUICK_ENTRY_ERROR_CODES,
  QUICK_ENTRY_MAX_FAILED_ATTEMPTS,
  QUICK_ENTRY_SETTING_KEYS,
} from "@/lib/public-pool/quick-entry-constants";
import {
  bumpQuickEntryGrantVersion,
  getQuickEntryAdminState,
  getQuickEntrySettingsInternal,
  QuickEntrySettingsError,
  setQuickEntryCode,
  setQuickEntryEnabled,
} from "@/lib/public-pool/quick-entry-settings";
import {
  getQuickEntryGrantStatusForSession,
  QuickEntrySecurityError,
  verifyQuickEntryCode,
} from "@/lib/public-pool/quick-entry-security";

const QE_ADMIN_ID = "qe111111-1111-1111-1111-111111111101";
const QE_STAFF_ID = "qe111111-1111-1111-1111-111111111102";
const QE_ADMIN_EMAIL = "qe-admin@crm.test.local";
const QE_STAFF_EMAIL = "qe-staff@crm.test.local";
const FAKE_DEVICE = "test-device-quick-entry-0000000000000000";
const VALID_CODE = "QuickEnt1";
const VALID_CODE_2 = "QuickEnt2";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;
let columnsReady = false;
let d1: {
  prepare: (query: string) => {
    all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  };
};

async function assertQuickEntryColumnsExist(): Promise<boolean> {
  const info = await d1.prepare("PRAGMA table_info(sessions)").all<{
    name: string;
  }>();
  const names = new Set((info.results ?? []).map((row) => row.name));
  return (
    names.has("quick_entry_grant_until") &&
    names.has("quick_entry_grant_version") &&
    names.has("quick_entry_failed_attempts") &&
    names.has("quick_entry_locked_until")
  );
}

async function cleanupQuickEntryFixtures() {
  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.action, "public_pool.quick_entry.%"));
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, QE_ADMIN_ID));
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, QE_STAFF_ID));
  for (const key of Object.values(QUICK_ENTRY_SETTING_KEYS)) {
    await db
      .delete(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key));
  }
  await db.delete(schema.users).where(eq(schema.users.id, QE_ADMIN_ID));
  await db.delete(schema.users).where(eq(schema.users.id, QE_STAFF_ID));
}

async function ensureUsers() {
  const now = new Date().toISOString();
  for (const user of [
    {
      id: QE_ADMIN_ID,
      email: QE_ADMIN_EMAIL,
      displayName: "QE Admin",
      role: "admin" as const,
    },
    {
      id: QE_STAFF_ID,
      email: QE_STAFF_EMAIL,
      displayName: "QE Staff",
      role: "staff" as const,
    },
  ]) {
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(schema.users).values({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        isActive: 1,
        passwordHash: "INVALID_HASH_TEST_ONLY",
        failedLoginAttempts: 0,
        lockedUntil: null,
        mustChangePassword: 0,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await db
        .update(schema.users)
        .set({
          isActive: 1,
          deletedAt: null,
          displayName: user.displayName,
          role: user.role,
          updatedAt: now,
        })
        .where(eq(schema.users.id, user.id));
    }
  }

  adminUser = (
    await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, QE_ADMIN_ID))
      .limit(1)
  )[0] as User;
  staffUser = (
    await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, QE_STAFF_ID))
      .limit(1)
  )[0] as User;
}

async function createTestSession(userId: string): Promise<string> {
  const fakeRequest = new Request("https://test.example.com/", {
    headers: { "user-agent": "qe-test-agent" },
  });
  const { sessionId } = await createSession(userId, fakeRequest, FAKE_DEVICE);
  return sessionId;
}

describe("public pool quick entry — DB integration", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    d1 = proxy.env.DB as typeof d1;
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);

    columnsReady = await assertQuickEntryColumnsExist();
    if (!columnsReady) {
      return;
    }

    await cleanupQuickEntryFixtures();
    await ensureUsers();
  });

  after(async () => {
    if (columnsReady) {
      await cleanupQuickEntryFixtures();
    }
    bindTestDatabase(null);
    if (disposeProxy) {
      await disposeProxy();
    }
  });

  it("requires additive migration 0033 columns on local D1", () => {
    if (!columnsReady) {
      assert.fail(
        "Local D1 missing quick_entry_* session columns. " +
          "getPlatformProxy does not auto-apply drizzle/migrations/0033_public_pool_quick_entry_security.sql. " +
          "QUICK-ENTRY-1 forbids agent-run wrangler d1 migrations apply; authorize local apply separately before DB suite.",
      );
    }
  });

  it("settings defaults when keys missing", async function (this: TestContext) {
    if (!columnsReady) {
      this.skip();
    }
    const internal = await getQuickEntrySettingsInternal(db);
    assert.equal(internal.enabled, false);
    assert.equal(internal.hasCode, false);
    assert.equal(internal.grantVersion, 1);
    assert.equal(internal.codeHash, "");

    const admin = await getQuickEntryAdminState(db);
    assert.equal(admin.hasCode, false);
    assert.equal("codeHash" in admin, false);
  });

  it("malformed grantVersion treated as 1", async function (this: TestContext) {
    if (!columnsReady) {
      this.skip();
    }
    const now = new Date().toISOString();
    await db.insert(schema.systemSettings).values({
      key: QUICK_ENTRY_SETTING_KEYS.grantVersion,
      value: "0",
      updatedBy: QE_ADMIN_ID,
      updatedAt: now,
    });
    const internal = await getQuickEntrySettingsInternal(db);
    assert.equal(internal.grantVersion, 1);
    await db
      .delete(schema.systemSettings)
      .where(eq(schema.systemSettings.key, QUICK_ENTRY_SETTING_KEYS.grantVersion));
  });

  it("set code stores hash, metadata, bumps version; admin state hides hash", async function (this: TestContext) {
    if (!columnsReady) {
      this.skip();
    }
    const before = await getQuickEntrySettingsInternal(db);
    assert.equal(before.grantVersion, 1);

    const state = await setQuickEntryCode(
      adminUser,
      VALID_CODE,
      VALID_CODE,
      { ipAddress: "127.0.0.1", userAgent: "qe-test" },
      db,
    );
    assert.equal(state.hasCode, true);
    assert.equal(state.enabled, false);
    assert.ok(state.codeUpdatedAt);
    assert.equal(state.updatedBy?.userId, QE_ADMIN_ID);
    assert.equal("codeHash" in state, false);

    const internal = await getQuickEntrySettingsInternal(db);
    assert.ok(internal.codeHash.length > 0);
    assert.notEqual(internal.codeHash, VALID_CODE);
    assert.equal(await verifyPassword(VALID_CODE, internal.codeHash), true);
    assert.ok(internal.grantVersion > before.grantVersion);
  });

  it("enable without code rejected; enable does not bump; disable bumps", async function (this: TestContext) {
    if (!columnsReady) {
      this.skip();
    }
    for (const key of Object.values(QUICK_ENTRY_SETTING_KEYS)) {
      await db
        .delete(schema.systemSettings)
        .where(eq(schema.systemSettings.key, key));
    }

    await assert.rejects(
      () =>
        setQuickEntryEnabled(
          adminUser,
          true,
          { ipAddress: null, userAgent: null },
          db,
        ),
      (err: unknown) =>
        err instanceof QuickEntrySettingsError &&
        err.errorCode === QUICK_ENTRY_ERROR_CODES.CODE_NOT_CONFIGURED,
    );

    await setQuickEntryCode(
      adminUser,
      VALID_CODE,
      VALID_CODE,
      { ipAddress: null, userAgent: null },
      db,
    );
    const afterCode = await getQuickEntrySettingsInternal(db);
    await setQuickEntryEnabled(
      adminUser,
      true,
      { ipAddress: null, userAgent: null },
      db,
    );
    const afterEnable = await getQuickEntrySettingsInternal(db);
    assert.equal(afterEnable.enabled, true);
    assert.equal(afterEnable.grantVersion, afterCode.grantVersion);

    await setQuickEntryEnabled(
      adminUser,
      false,
      { ipAddress: null, userAgent: null },
      db,
    );
    const afterDisable = await getQuickEntrySettingsInternal(db);
    assert.equal(afterDisable.enabled, false);
    assert.ok(afterDisable.grantVersion > afterEnable.grantVersion);
  });

  it("concurrent grantVersion bumps never decrease", async function (this: TestContext) {
    if (!columnsReady) {
      this.skip();
    }
    const now = new Date().toISOString();
    await db
      .delete(schema.systemSettings)
      .where(eq(schema.systemSettings.key, QUICK_ENTRY_SETTING_KEYS.grantVersion));
    await db.insert(schema.systemSettings).values({
      key: QUICK_ENTRY_SETTING_KEYS.grantVersion,
      value: "5",
      updatedBy: QE_ADMIN_ID,
      updatedAt: now,
    });

    const [a, b] = await Promise.all([
      bumpQuickEntryGrantVersion(db, QE_ADMIN_ID, now),
      bumpQuickEntryGrantVersion(db, QE_STAFF_ID, now),
    ]);
    assert.ok(a >= 6);
    assert.ok(b >= 6);
    const final = await getQuickEntrySettingsInternal(db);
    // Both SQL increments must land (5 → 7); never decrease.
    assert.equal(final.grantVersion, 7);
  });

  it("verify success / wrong attempts / fifth locks / locked does not increment", async function (this: TestContext) {
    if (!columnsReady) {
      this.skip();
    }
    for (const key of Object.values(QUICK_ENTRY_SETTING_KEYS)) {
      await db
        .delete(schema.systemSettings)
        .where(eq(schema.systemSettings.key, key));
    }
    await setQuickEntryCode(
      adminUser,
      VALID_CODE,
      VALID_CODE,
      { ipAddress: null, userAgent: null },
      db,
    );
    await setQuickEntryEnabled(
      adminUser,
      true,
      { ipAddress: null, userAgent: null },
      db,
    );

    const sessionId = await createTestSession(QE_STAFF_ID);
    const ok = await verifyQuickEntryCode({
      user: staffUser,
      sessionId,
      code: VALID_CODE,
      db,
    });
    assert.equal(ok.ok, true);

    const status = await getQuickEntryGrantStatusForSession(sessionId, db);
    assert.equal(status.grantActive, true);

    // Clear grant then fail 4 times.
    await db
      .update(schema.sessions)
      .set({
        quickEntryGrantUntil: null,
        quickEntryGrantVersion: null,
        quickEntryFailedAttempts: 0,
        quickEntryLockedUntil: null,
      })
      .where(eq(schema.sessions.id, sessionId));

    for (let i = 1; i <= 4; i += 1) {
      await assert.rejects(
        () =>
          verifyQuickEntryCode({
            user: staffUser,
            sessionId,
            code: "WrongCode1",
            db,
          }),
        (err: unknown) =>
          err instanceof QuickEntrySecurityError &&
          err.errorCode === QUICK_ENTRY_ERROR_CODES.CODE_INVALID,
      );
    }

    await assert.rejects(
      () =>
        verifyQuickEntryCode({
          user: staffUser,
          sessionId,
          code: "WrongCode1",
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySecurityError &&
        err.errorCode === QUICK_ENTRY_ERROR_CODES.RATE_LIMITED &&
        err.httpStatus === 429 &&
        (err.retryAfterSeconds ?? 0) > 0,
    );

    const lockedRow = (
      await db
        .select({
          attempts: schema.sessions.quickEntryFailedAttempts,
          lockedUntil: schema.sessions.quickEntryLockedUntil,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1)
    )[0];
    assert.equal(lockedRow?.attempts, QUICK_ENTRY_MAX_FAILED_ATTEMPTS);
    assert.ok(lockedRow?.lockedUntil);

    // Locked verify must not bump attempts further.
    await assert.rejects(
      () =>
        verifyQuickEntryCode({
          user: adminUser,
          sessionId,
          code: "WrongCode1",
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySecurityError &&
        err.errorCode === QUICK_ENTRY_ERROR_CODES.RATE_LIMITED,
    );
    const afterLocked = (
      await db
        .select({ attempts: schema.sessions.quickEntryFailedAttempts })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1)
    )[0];
    assert.equal(afterLocked?.attempts, QUICK_ENTRY_MAX_FAILED_ATTEMPTS);
  });

  it("admin does not bypass lockout; success clears attempts; disable invalidates grant", async function (this: TestContext) {
    if (!columnsReady) {
      this.skip();
    }
    for (const key of Object.values(QUICK_ENTRY_SETTING_KEYS)) {
      await db
        .delete(schema.systemSettings)
        .where(eq(schema.systemSettings.key, key));
    }
    await setQuickEntryCode(
      adminUser,
      VALID_CODE,
      VALID_CODE,
      { ipAddress: null, userAgent: null },
      db,
    );
    await setQuickEntryEnabled(
      adminUser,
      true,
      { ipAddress: null, userAgent: null },
      db,
    );

    const sessionId = await createTestSession(QE_ADMIN_ID);
    const past = new Date(Date.now() - 60_000).toISOString();
    await db
      .update(schema.sessions)
      .set({
        quickEntryFailedAttempts: 5,
        quickEntryLockedUntil: past,
      })
      .where(eq(schema.sessions.id, sessionId));

    const ok = await verifyQuickEntryCode({
      user: adminUser,
      sessionId,
      code: VALID_CODE,
      db,
    });
    assert.equal(ok.ok, true);
    const row = (
      await db
        .select({
          attempts: schema.sessions.quickEntryFailedAttempts,
          lockedUntil: schema.sessions.quickEntryLockedUntil,
          grantVersion: schema.sessions.quickEntryGrantVersion,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1)
    )[0];
    assert.equal(row?.attempts, 0);
    assert.equal(row?.lockedUntil, null);

    const beforeDisable = await getQuickEntryGrantStatusForSession(sessionId, db);
    assert.equal(beforeDisable.grantActive, true);

    await setQuickEntryEnabled(
      adminUser,
      false,
      { ipAddress: null, userAgent: null },
      db,
    );
    const afterDisable = await getQuickEntryGrantStatusForSession(sessionId, db);
    assert.equal(afterDisable.enabled, false);
    assert.equal(afterDisable.grantActive, false);

    await assert.rejects(
      () =>
        verifyQuickEntryCode({
          user: adminUser,
          sessionId,
          code: VALID_CODE,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySecurityError &&
        err.errorCode === QUICK_ENTRY_ERROR_CODES.DISABLED,
    );
  });

  it("code reset bumps version and invalidates old grant; concurrent wrong verifies count", async function (this: TestContext) {
    if (!columnsReady) {
      this.skip();
    }
    for (const key of Object.values(QUICK_ENTRY_SETTING_KEYS)) {
      await db
        .delete(schema.systemSettings)
        .where(eq(schema.systemSettings.key, key));
    }
    await setQuickEntryCode(
      adminUser,
      VALID_CODE,
      VALID_CODE,
      { ipAddress: null, userAgent: null },
      db,
    );
    await setQuickEntryEnabled(
      adminUser,
      true,
      { ipAddress: null, userAgent: null },
      db,
    );

    const sessionId = await createTestSession(QE_STAFF_ID);
    await verifyQuickEntryCode({
      user: staffUser,
      sessionId,
      code: VALID_CODE,
      db,
    });
    assert.equal(
      (await getQuickEntryGrantStatusForSession(sessionId, db)).grantActive,
      true,
    );

    await setQuickEntryCode(
      adminUser,
      VALID_CODE_2,
      VALID_CODE_2,
      { ipAddress: null, userAgent: null },
      db,
    );
    assert.equal(
      (await getQuickEntryGrantStatusForSession(sessionId, db)).grantActive,
      false,
    );

    await db
      .update(schema.sessions)
      .set({
        quickEntryFailedAttempts: 0,
        quickEntryLockedUntil: null,
        quickEntryGrantUntil: null,
        quickEntryGrantVersion: null,
      })
      .where(eq(schema.sessions.id, sessionId));

    await Promise.all([
      verifyQuickEntryCode({
        user: staffUser,
        sessionId,
        code: "WrongCode1",
        db,
      }).catch(() => null),
      verifyQuickEntryCode({
        user: staffUser,
        sessionId,
        code: "WrongCode1",
        db,
      }).catch(() => null),
    ]);

    const attempts = (
      await db
        .select({ attempts: schema.sessions.quickEntryFailedAttempts })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1)
    )[0]?.attempts;
    assert.equal(attempts, 2);
  });

  it("audit logs never contain code or hash", async function (this: TestContext) {
    if (!columnsReady) {
      this.skip();
    }
    const audits = await db
      .select({
        action: schema.auditLogs.action,
        metadata: schema.auditLogs.metadata,
      })
      .from(schema.auditLogs)
      .where(
        and(
          like(schema.auditLogs.action, "public_pool.quick_entry.%"),
          eq(schema.auditLogs.userId, QE_ADMIN_ID),
        ),
      );

    for (const row of audits) {
      const meta = row.metadata ?? "";
      assert.equal(meta.includes(VALID_CODE), false);
      assert.equal(meta.includes(VALID_CODE_2), false);
      assert.equal(meta.includes("pbkdf2:"), false);
      assert.equal(meta.toLowerCase().includes("codehash"), false);
    }
  });
});
