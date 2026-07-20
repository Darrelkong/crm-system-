import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import {
  createSession,
  validateSessionToken,
} from "@/lib/auth/session";
import {
  GLOBAL_IDLE_EXEMPTION_AUDIT_ACTION,
  GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY,
  STAFF_ACCESS_REVERIFY_AFTER_KEY,
  getGlobalIdlePolicy,
  updateGlobalIdleTimeoutExemption,
} from "@/lib/settings/global-idle-exemption";
import {
  SettingsError,
  updateSystemSettings,
} from "@/lib/settings/service";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;

const FAKE_DEVICE = "test-device-global-idle-000000000000000";

async function cleanupSessions() {
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, SEED_IDS.staffA));
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, SEED_IDS.admin));
}

async function cleanupGlobalIdleSettings() {
  for (const key of [
    GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY,
    STAFF_ACCESS_REVERIFY_AFTER_KEY,
  ]) {
    await db
      .delete(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key));
  }
}

async function cleanupAudits() {
  await db
    .delete(schema.auditLogs)
    .where(eq(schema.auditLogs.action, GLOBAL_IDLE_EXEMPTION_AUDIT_ACTION));
}

async function setDeviceAuthEnabled(enabled: boolean) {
  const value = enabled ? "true" : "false";
  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, "device_authorization_enabled"))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(schema.systemSettings)
      .set({ value, updatedAt: now })
      .where(eq(schema.systemSettings.key, "device_authorization_enabled"));
  } else {
    await db.insert(schema.systemSettings).values({
      key: "device_authorization_enabled",
      value,
      updatedAt: now,
    });
  }
}

async function upsertSetting(key: string, value: string) {
  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(schema.systemSettings)
      .set({ value, updatedAt: now })
      .where(eq(schema.systemSettings.key, key));
  } else {
    await db.insert(schema.systemSettings).values({
      key,
      value,
      updatedAt: now,
    });
  }
}

async function createTestSession(userId: string): Promise<{
  token: string;
  sessionId: string;
}> {
  const fakeRequest = new Request("https://test.example.com/", {
    headers: { "user-agent": "test-agent" },
  });
  return createSession(userId, fakeRequest, FAKE_DEVICE);
}

describe("global idle exemption — DB integration", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
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

    await setDeviceAuthEnabled(false);
    await cleanupSessions();
    await cleanupGlobalIdleSettings();
    await cleanupAudits();
  });

  after(async () => {
    await setDeviceAuthEnabled(false);
    // Restore staff active flag if a test flipped it.
    await db
      .update(schema.users)
      .set({ isActive: 1 })
      .where(eq(schema.users.id, SEED_IDS.staffA));
    await cleanupSessions();
    await cleanupGlobalIdleSettings();
    await cleanupAudits();
    bindTestDatabase(null);
    if (disposeProxy) {
      await disposeProxy();
    }
  });

  describe("getGlobalIdlePolicy defaults", () => {
    it("returns enabled=false and epoch=0 when rows are missing", async () => {
      await cleanupGlobalIdleSettings();
      const policy = await getGlobalIdlePolicy(db);
      assert.equal(policy.globalIdleTimeoutExempt, false);
      assert.equal(policy.staffAccessReverifyAfter, 0);
    });

    it("parses enabled true/false; illegal enabled is not true", async () => {
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "true");
      assert.equal((await getGlobalIdlePolicy(db)).globalIdleTimeoutExempt, true);

      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "false");
      assert.equal(
        (await getGlobalIdlePolicy(db)).globalIdleTimeoutExempt,
        false,
      );

      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "yes");
      assert.equal(
        (await getGlobalIdlePolicy(db)).globalIdleTimeoutExempt,
        false,
      );
    });
  });

  describe("updateGlobalIdleTimeoutExemption transitions", () => {
    it("false → true enables without touching epoch", async () => {
      await cleanupGlobalIdleSettings();
      await cleanupAudits();
      await upsertSetting(STAFF_ACCESS_REVERIFY_AFTER_KEY, "12345");

      const result = await updateGlobalIdleTimeoutExemption(
        adminUser,
        true,
        {},
        db,
      );
      assert.equal(result.enabled, true);
      assert.equal(result.changed, true);
      assert.equal(result.staffAccessReverifyAfter, 12345);

      const policy = await getGlobalIdlePolicy(db);
      assert.equal(policy.globalIdleTimeoutExempt, true);
      assert.equal(policy.staffAccessReverifyAfter, 12345);

      const audits = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, GLOBAL_IDLE_EXEMPTION_AUDIT_ACTION));
      assert.equal(audits.length, 1);
    });

    it("true → false disables and refreshes epoch with audit", async () => {
      await cleanupAudits();
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "true");
      await upsertSetting(STAFF_ACCESS_REVERIFY_AFTER_KEY, "100");

      const before = Math.floor(Date.now() / 1000);
      const result = await updateGlobalIdleTimeoutExemption(
        adminUser,
        false,
        {},
        db,
      );
      const after = Math.floor(Date.now() / 1000);

      assert.equal(result.enabled, false);
      assert.equal(result.changed, true);
      assert.ok(result.staffAccessReverifyAfter >= before);
      assert.ok(result.staffAccessReverifyAfter <= after);
      assert.notEqual(result.staffAccessReverifyAfter, 100);

      const policy = await getGlobalIdlePolicy(db);
      assert.equal(policy.globalIdleTimeoutExempt, false);
      assert.equal(
        policy.staffAccessReverifyAfter,
        result.staffAccessReverifyAfter,
      );

      const audits = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, GLOBAL_IDLE_EXEMPTION_AUDIT_ACTION));
      assert.equal(audits.length, 1);
      const meta = JSON.parse(audits[0]!.metadata ?? "{}") as {
        enabled?: boolean;
        staffAccessReverifyAfter?: string;
        requiresAccessReverification?: boolean;
      };
      assert.equal(meta.enabled, false);
      assert.equal(meta.requiresAccessReverification, true);
      assert.equal(
        meta.staffAccessReverifyAfter,
        String(result.staffAccessReverifyAfter),
      );
    });

    it("false → false does not refresh epoch or write audit", async () => {
      await cleanupAudits();
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "false");
      await upsertSetting(STAFF_ACCESS_REVERIFY_AFTER_KEY, "999");

      const result = await updateGlobalIdleTimeoutExemption(
        adminUser,
        false,
        {},
        db,
      );
      assert.equal(result.changed, false);
      assert.equal(result.staffAccessReverifyAfter, 999);

      const audits = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, GLOBAL_IDLE_EXEMPTION_AUDIT_ACTION));
      assert.equal(audits.length, 0);
    });

    it("true → true does not refresh epoch or write audit", async () => {
      await cleanupAudits();
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "true");
      await upsertSetting(STAFF_ACCESS_REVERIFY_AFTER_KEY, "888");

      const result = await updateGlobalIdleTimeoutExemption(
        adminUser,
        true,
        {},
        db,
      );
      assert.equal(result.changed, false);
      assert.equal(result.enabled, true);
      assert.equal(result.staffAccessReverifyAfter, 888);

      const audits = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, GLOBAL_IDLE_EXEMPTION_AUDIT_ACTION));
      assert.equal(audits.length, 0);
    });
  });

  describe("ordinary settings protection", () => {
    it("rejects dedicated-only global switch via updateSystemSettings", async () => {
      await assert.rejects(
        () =>
          updateSystemSettings(
            adminUser,
            { global_idle_timeout_exempt_enabled: "true" },
            {},
          ),
        (err: unknown) =>
          err instanceof SettingsError &&
          err.message.includes("专用接口"),
      );
    });

    it("rejects epoch key as unknown via updateSystemSettings", async () => {
      await assert.rejects(
        () =>
          updateSystemSettings(
            adminUser,
            { staff_access_reverify_after: "123" } as Record<string, string>,
            {},
          ),
        (err: unknown) =>
          err instanceof SettingsError &&
          err.message.includes("未知配置项"),
      );
    });

    it("still allows device_authorization_enabled updates", async () => {
      const result = await updateSystemSettings(
        adminUser,
        { device_authorization_enabled: "false" },
        {},
      );
      assert.equal(result.device_authorization_enabled, "false");
    });
  });

  describe("validateSessionToken — global idle and epoch", () => {
    it("global false + idle past 30m → SESSION_IDLE_EXPIRED", async () => {
      await cleanupSessions();
      await cleanupGlobalIdleSettings();
      const { token, sessionId } = await createTestSession(staffUser.id);
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await db
        .update(schema.sessions)
        .set({ lastActivityAt: old })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "idle_expired");
        assert.equal(
          result.errorCode,
          AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED,
        );
      }
    });

    it("global true + idle past 30m → ok with globalIdleTimeoutExempt", async () => {
      await cleanupSessions();
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "true");
      await upsertSetting(STAFF_ACCESS_REVERIFY_AFTER_KEY, "0");

      const { token, sessionId } = await createTestSession(staffUser.id);
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await db
        .update(schema.sessions)
        .set({ lastActivityAt: old })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.globalIdleTimeoutExempt, true);
      }
    });

    it("global true does not skip absolute TTL expiry", async () => {
      await cleanupSessions();
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "true");
      const { token, sessionId } = await createTestSession(staffUser.id);
      const past = new Date(Date.now() - 60_000).toISOString();
      await db
        .update(schema.sessions)
        .set({ expiresAt: past })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "invalid");
        assert.equal(result.errorCode, AUTH_ERROR_CODES.SESSION_INVALID);
      }
    });

    it("global true does not skip inactive user", async () => {
      await cleanupSessions();
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "true");
      const { token } = await createTestSession(staffUser.id);
      await db
        .update(schema.users)
        .set({ isActive: 0 })
        .where(eq(schema.users.id, SEED_IDS.staffA));

      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "inactive_user");
      }

      await db
        .update(schema.users)
        .set({ isActive: 1 })
        .where(eq(schema.users.id, SEED_IDS.staffA));
    });

    it("global true does not skip revoked session", async () => {
      await cleanupSessions();
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "true");
      const { token, sessionId } = await createTestSession(staffUser.id);
      await db
        .update(schema.sessions)
        .set({ revokedAt: new Date().toISOString() })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "revoked");
        assert.equal(result.errorCode, AUTH_ERROR_CODES.SESSION_REVOKED);
      }
    });

    it("global true does not skip device revoked for staff", async () => {
      await cleanupSessions();
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "true");
      await setDeviceAuthEnabled(true);
      const { token } = await createTestSession(staffUser.id);

      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "device_revoked");
        assert.equal(
          result.errorCode,
          AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED,
        );
      }
      await setDeviceAuthEnabled(false);
    });

    it("staff session createdAt <= epoch → access_reverify", async () => {
      await cleanupSessions();
      await setDeviceAuthEnabled(false);
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "false");
      const epoch = Math.floor(Date.now() / 1000);
      await upsertSetting(STAFF_ACCESS_REVERIFY_AFTER_KEY, String(epoch));

      const { token, sessionId } = await createTestSession(staffUser.id);
      const oldCreated = new Date((epoch - 30) * 1000).toISOString();
      await db
        .update(schema.sessions)
        .set({ createdAt: oldCreated, lastActivityAt: new Date().toISOString() })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "access_reverify");
        assert.equal(
          result.errorCode,
          AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED,
        );
      }

      const row = await db
        .select({ revokedAt: schema.sessions.revokedAt })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1);
      assert.equal(row[0]?.revokedAt, null);
    });

    it("admin session createdAt <= epoch is not blocked", async () => {
      await cleanupSessions();
      const epoch = Math.floor(Date.now() / 1000);
      await upsertSetting(STAFF_ACCESS_REVERIFY_AFTER_KEY, String(epoch));
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "false");

      const { token, sessionId } = await createTestSession(adminUser.id);
      const oldCreated = new Date((epoch - 30) * 1000).toISOString();
      await db
        .update(schema.sessions)
        .set({ createdAt: oldCreated, lastActivityAt: new Date().toISOString() })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.globalIdleTimeoutExempt, false);
      }
    });

    it("staff session createdAt > epoch passes epoch check", async () => {
      await cleanupSessions();
      const epoch = Math.floor(Date.now() / 1000) - 120;
      await upsertSetting(STAFF_ACCESS_REVERIFY_AFTER_KEY, String(epoch));
      await upsertSetting(GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY, "false");

      const { token } = await createTestSession(staffUser.id);
      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, true);
    });

    it("global false + per-session idleExemptUntil still skips idle", async () => {
      await cleanupSessions();
      await cleanupGlobalIdleSettings();
      const { token, sessionId } = await createTestSession(staffUser.id);
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db
        .update(schema.sessions)
        .set({ lastActivityAt: old, idleExemptUntil: future })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.globalIdleTimeoutExempt, false);
      }
    });
  });
});
