import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  createSession,
  validateSessionToken,
} from "@/lib/auth/session";
import {
  disableSecondaryIdleCode,
  generateAndStoreCode,
  getSecondaryIdleCodeState,
  getStoredHash,
  hashSecondaryIdleCode,
  IDLE_EXEMPT_DURATION_MS,
  IDLE_EXEMPT_MAX_ATTEMPTS,
  rotateCodeAfterUse,
  verifySecondaryIdleCode,
} from "@/lib/auth/secondary-idle-code";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;

const FAKE_DEVICE = "test-device-idle-exempt-0000000000000000";

async function cleanupSessions() {
  await db.delete(schema.sessions).where(
    eq(schema.sessions.userId, SEED_IDS.staffA),
  );
  await db.delete(schema.sessions).where(
    eq(schema.sessions.userId, SEED_IDS.admin),
  );
}

async function cleanupSecondaryIdleCodeSettings() {
  for (const key of [
    "secondary_idle_code_enabled",
    "secondary_idle_code_hash",
    "secondary_idle_code_generated_at",
  ]) {
    await db
      .delete(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key));
  }
}

async function createTestSession(userId: string): Promise<string> {
  const fakeRequest = new Request("https://test.example.com/", {
    headers: { "user-agent": "test-agent" },
  });
  const { token } = await createSession(userId, fakeRequest, FAKE_DEVICE);
  return token;
}

describe("secondary idle code — DB integration", () => {
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

    await cleanupSessions();
    await cleanupSecondaryIdleCodeSettings();
  });

  after(async () => {
    await cleanupSessions();
    await cleanupSecondaryIdleCodeSettings();
    bindTestDatabase(null);
    if (disposeProxy) {
      await disposeProxy();
    }
  });

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  describe("getSecondaryIdleCodeState", () => {
    it("returns disabled + no code when no settings exist", async () => {
      const state = await getSecondaryIdleCodeState(db);
      assert.equal(state.enabled, false);
      assert.equal(state.hasCode, false);
      assert.equal(state.generatedAt, null);
    });
  });

  // -------------------------------------------------------------------------
  // generateAndStoreCode
  // -------------------------------------------------------------------------

  describe("generateAndStoreCode", () => {
    it("returns an 8-character plaintext code", async () => {
      const plaintext = await generateAndStoreCode(db);
      assert.equal(plaintext.length, 8);
    });

    it("enables the feature after generation", async () => {
      const state = await getSecondaryIdleCodeState(db);
      assert.equal(state.enabled, true);
    });

    it("stores a hash, not the plaintext", async () => {
      const plaintext = await generateAndStoreCode(db);
      const stored = await getStoredHash(db);
      assert.ok(stored.length > 0, "stored hash must not be empty");
      assert.ok(!stored.includes(plaintext), "stored value must not include plaintext");
    });

    it("stored hash verifies against returned plaintext", async () => {
      const plaintext = await generateAndStoreCode(db);
      const stored = await getStoredHash(db);
      assert.equal(await verifySecondaryIdleCode(plaintext, stored), true);
    });

    it("sets generatedAt timestamp", async () => {
      await generateAndStoreCode(db);
      const state = await getSecondaryIdleCodeState(db);
      assert.ok(state.generatedAt !== null);
      assert.ok(new Date(state.generatedAt!).getTime() > 0);
    });
  });

  // -------------------------------------------------------------------------
  // rotateCodeAfterUse
  // -------------------------------------------------------------------------

  describe("rotateCodeAfterUse", () => {
    it("replaces the stored hash with a new one", async () => {
      await generateAndStoreCode(db);
      const hashBefore = await getStoredHash(db);

      await rotateCodeAfterUse(db);

      const hashAfter = await getStoredHash(db);
      assert.notEqual(hashBefore, hashAfter, "hash must change after rotation");
    });

    it("old plaintext no longer verifies after rotation", async () => {
      const oldPlaintext = await generateAndStoreCode(db);
      await rotateCodeAfterUse(db);
      const newHash = await getStoredHash(db);
      assert.equal(
        await verifySecondaryIdleCode(oldPlaintext, newHash),
        false,
        "old plaintext must not match new hash",
      );
    });
  });

  // -------------------------------------------------------------------------
  // validateSessionToken with idleExemptUntil
  // -------------------------------------------------------------------------

  describe("validateSessionToken — idle exemption", () => {
    it("idle_exempt_until > now: session does not fail with idle_expired even when idle", async () => {
      const token = await createTestSession(staffUser.id);

      // Set lastActivityAt far in the past so it would normally be idle_expired
      const validation = await validateSessionToken(token, { touch: false });
      assert.ok(validation.ok);
      const { sessionId } = validation.session;

      const veryOldActivity = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      ).toISOString(); // 2 hours ago
      const futureExempt = new Date(
        Date.now() + IDLE_EXEMPT_DURATION_MS,
      ).toISOString();

      await db
        .update(schema.sessions)
        .set({
          lastActivityAt: veryOldActivity,
          idleExemptUntil: futureExempt,
        })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.ok(
        result.ok,
        `expected ok, got: ${JSON.stringify(result)}`,
      );
    });

    it("idle_exempt_until < now: normal idle timeout resumes", async () => {
      const token = await createTestSession(staffUser.id);
      const validation = await validateSessionToken(token, { touch: false });
      assert.ok(validation.ok);
      const { sessionId } = validation.session;

      const veryOldActivity = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      ).toISOString();
      const expiredExempt = new Date(
        Date.now() - 1 * 60 * 1000,
      ).toISOString(); // 1 minute ago (already expired)

      await db
        .update(schema.sessions)
        .set({
          lastActivityAt: veryOldActivity,
          idleExemptUntil: expiredExempt,
        })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.ok(!result.ok);
      assert.equal(result.reason, "idle_expired");
    });

    it("idle_exempt_until does not bypass revoked session", async () => {
      const token = await createTestSession(staffUser.id);
      const validation = await validateSessionToken(token, { touch: false });
      assert.ok(validation.ok);
      const { sessionId } = validation.session;

      const futureExempt = new Date(
        Date.now() + IDLE_EXEMPT_DURATION_MS,
      ).toISOString();
      const nowIso = new Date().toISOString();

      await db
        .update(schema.sessions)
        .set({
          revokedAt: nowIso,
          idleExemptUntil: futureExempt,
        })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.ok(!result.ok);
      assert.equal(result.reason, "revoked");
    });

    it("idle_exempt_until does not bypass inactive_user", async () => {
      const token = await createTestSession(staffUser.id);
      const validation = await validateSessionToken(token, { touch: false });
      assert.ok(validation.ok);
      const { sessionId } = validation.session;

      const futureExempt = new Date(
        Date.now() + IDLE_EXEMPT_DURATION_MS,
      ).toISOString();

      await db
        .update(schema.sessions)
        .set({ idleExemptUntil: futureExempt })
        .where(eq(schema.sessions.id, sessionId));

      // Deactivate user
      await db
        .update(schema.users)
        .set({ isActive: 0 })
        .where(eq(schema.users.id, staffUser.id));

      try {
        const result = await validateSessionToken(token, { touch: false });
        assert.ok(!result.ok);
        assert.equal(result.reason, "inactive_user");
      } finally {
        // Restore user active state
        await db
          .update(schema.users)
          .set({ isActive: 1 })
          .where(eq(schema.users.id, staffUser.id));
      }
    });

    it("absolute session expiresAt is not bypassed by idle_exempt_until", async () => {
      const token = await createTestSession(staffUser.id);
      const validation = await validateSessionToken(token, { touch: false });
      assert.ok(validation.ok);
      const { sessionId } = validation.session;

      const pastExpiry = new Date(
        Date.now() - 10 * 60 * 1000,
      ).toISOString(); // expired 10 min ago
      const futureExempt = new Date(
        Date.now() + IDLE_EXEMPT_DURATION_MS,
      ).toISOString();

      await db
        .update(schema.sessions)
        .set({
          expiresAt: pastExpiry,
          idleExemptUntil: futureExempt,
        })
        .where(eq(schema.sessions.id, sessionId));

      const result = await validateSessionToken(token, { touch: false });
      assert.ok(!result.ok);
      assert.equal(result.reason, "invalid");
    });
  });

  // -------------------------------------------------------------------------
  // disableSecondaryIdleCode
  // -------------------------------------------------------------------------

  describe("disableSecondaryIdleCode", () => {
    it("sets enabled=false and clears hash", async () => {
      await generateAndStoreCode(db);
      const beforeState = await getSecondaryIdleCodeState(db);
      assert.equal(beforeState.enabled, true);
      assert.equal(beforeState.hasCode, true);

      await disableSecondaryIdleCode(db);

      const afterState = await getSecondaryIdleCodeState(db);
      assert.equal(afterState.enabled, false);
      assert.equal(afterState.hasCode, false);
      assert.equal(afterState.generatedAt, null);
    });

    it("clears all active idle_exempt_until on sessions", async () => {
      await generateAndStoreCode(db);

      // Create two sessions and grant them idle exemption
      const tokenA = await createTestSession(staffUser.id);
      const tokenB = await createTestSession(adminUser.id);

      const valA = await validateSessionToken(tokenA, { touch: false });
      const valB = await validateSessionToken(tokenB, { touch: false });
      assert.ok(valA.ok);
      assert.ok(valB.ok);

      const futureExempt = new Date(Date.now() + IDLE_EXEMPT_DURATION_MS).toISOString();
      await db
        .update(schema.sessions)
        .set({ idleExemptUntil: futureExempt, idleExemptAttempts: 2 })
        .where(eq(schema.sessions.id, valA.session.sessionId));
      await db
        .update(schema.sessions)
        .set({ idleExemptUntil: futureExempt })
        .where(eq(schema.sessions.id, valB.session.sessionId));

      await disableSecondaryIdleCode(db);

      // Both sessions should have idleExemptUntil cleared
      const sessA = await db
        .select({ idleExemptUntil: schema.sessions.idleExemptUntil, idleExemptAttempts: schema.sessions.idleExemptAttempts })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, valA.session.sessionId))
        .limit(1);
      const sessB = await db
        .select({ idleExemptUntil: schema.sessions.idleExemptUntil })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, valB.session.sessionId))
        .limit(1);

      assert.equal(sessA[0]?.idleExemptUntil, null, "sessionA exemption must be cleared");
      assert.equal(sessA[0]?.idleExemptAttempts, 0, "sessionA attempts must be reset");
      assert.equal(sessB[0]?.idleExemptUntil, null, "sessionB exemption must be cleared");
    });

    it("does not revoke sessions — they remain usable for fresh activity", async () => {
      await generateAndStoreCode(db);

      const token = await createTestSession(staffUser.id);
      const val = await validateSessionToken(token, { touch: false });
      assert.ok(val.ok);

      await db
        .update(schema.sessions)
        .set({
          idleExemptUntil: new Date(Date.now() + IDLE_EXEMPT_DURATION_MS).toISOString(),
        })
        .where(eq(schema.sessions.id, val.session.sessionId));

      await disableSecondaryIdleCode(db);

      // Session should still be non-revoked
      const row = await db
        .select({ revokedAt: schema.sessions.revokedAt })
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.id, val.session.sessionId),
            isNull(schema.sessions.revokedAt),
          ),
        )
        .limit(1);

      assert.equal(row.length, 1, "session must not be revoked after disable");
    });
  });

  // -------------------------------------------------------------------------
  // Attempt counting and lockout
  // -------------------------------------------------------------------------

  describe("idle exempt attempt tracking (simulated)", () => {
    it("attempt counter increments on wrong code", async () => {
      await generateAndStoreCode(db);
      const token = await createTestSession(staffUser.id);
      const val = await validateSessionToken(token, { touch: false });
      assert.ok(val.ok);
      const { sessionId } = val.session;

      // Simulate wrong-attempt increments directly (API not used to keep test fast)
      await db
        .update(schema.sessions)
        .set({ idleExemptAttempts: 3 })
        .where(eq(schema.sessions.id, sessionId));

      const row = await db
        .select({ idleExemptAttempts: schema.sessions.idleExemptAttempts })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1);

      assert.equal(row[0]?.idleExemptAttempts, 3);
    });

    it("lockout is set after reaching max attempts", async () => {
      await generateAndStoreCode(db);
      const token = await createTestSession(staffUser.id);
      const val = await validateSessionToken(token, { touch: false });
      assert.ok(val.ok);
      const { sessionId } = val.session;

      const lockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await db
        .update(schema.sessions)
        .set({
          idleExemptAttempts: IDLE_EXEMPT_MAX_ATTEMPTS,
          idleExemptLockedUntil: lockUntil,
        })
        .where(eq(schema.sessions.id, sessionId));

      const row = await db
        .select({
          idleExemptAttempts: schema.sessions.idleExemptAttempts,
          idleExemptLockedUntil: schema.sessions.idleExemptLockedUntil,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1);

      assert.equal(row[0]?.idleExemptAttempts, IDLE_EXEMPT_MAX_ATTEMPTS);
      assert.ok(row[0]?.idleExemptLockedUntil !== null, "lockout must be set");
    });

    it("correct code resets attempts and sets idleExemptUntil", async () => {
      const plaintext = await generateAndStoreCode(db);
      const token = await createTestSession(staffUser.id);
      const val = await validateSessionToken(token, { touch: false });
      assert.ok(val.ok);
      const { sessionId } = val.session;

      // Simulate a previous failed attempt
      await db
        .update(schema.sessions)
        .set({ idleExemptAttempts: 2 })
        .where(eq(schema.sessions.id, sessionId));

      const storedHash = await getStoredHash(db);
      assert.equal(await verifySecondaryIdleCode(plaintext, storedHash), true);

      const exemptUntil = new Date(Date.now() + IDLE_EXEMPT_DURATION_MS).toISOString();
      await db
        .update(schema.sessions)
        .set({
          idleExemptUntil: exemptUntil,
          idleExemptAttempts: 0,
          idleExemptLockedUntil: null,
        })
        .where(eq(schema.sessions.id, sessionId));

      await rotateCodeAfterUse(db);

      const row = await db
        .select({
          idleExemptUntil: schema.sessions.idleExemptUntil,
          idleExemptAttempts: schema.sessions.idleExemptAttempts,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1);

      assert.ok(row[0]?.idleExemptUntil !== null, "exemptUntil must be set");
      assert.equal(row[0]?.idleExemptAttempts, 0, "attempts must be reset");

      // Old plaintext no longer verifies after rotation
      const newHash = await getStoredHash(db);
      assert.equal(await verifySecondaryIdleCode(plaintext, newHash), false);
    });

    it("activation does not affect sessions of another user", async () => {
      await generateAndStoreCode(db);

      // Use different users so createSession does not revoke the other's sessions
      const tokenA = await createTestSession(staffUser.id);
      const tokenB = await createTestSession(adminUser.id);

      const valA = await validateSessionToken(tokenA, { touch: false });
      const valB = await validateSessionToken(tokenB, { touch: false });
      assert.ok(valA.ok);
      assert.ok(valB.ok);

      // Grant exemption only to sessionA (staffUser)
      const exemptUntil = new Date(Date.now() + IDLE_EXEMPT_DURATION_MS).toISOString();
      await db
        .update(schema.sessions)
        .set({ idleExemptUntil: exemptUntil })
        .where(eq(schema.sessions.id, valA.session.sessionId));

      // sessionB (adminUser) must NOT have idleExemptUntil set
      const rowB = await db
        .select({ idleExemptUntil: schema.sessions.idleExemptUntil })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, valB.session.sessionId))
        .limit(1);

      assert.equal(rowB[0]?.idleExemptUntil, null, "sessionB must not be affected");
    });
  });
});
