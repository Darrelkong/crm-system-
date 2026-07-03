import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { hashDeviceId } from "@/lib/auth/device";
import {
  approveAuthorizedDevice,
  DeviceAdminError,
  evaluateStaffDeviceLogin,
  isDeviceApprovedForSession,
  recordAdminDeviceOnLogin,
  rejectAuthorizedDevice,
  revokeAuthorizedDevice,
} from "@/lib/devices/service";
import { createSession, validateSessionToken } from "@/lib/auth/session";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;

const DEVICE_A = "device-a-test-id-012345678901234567890";
const DEVICE_B = "device-b-test-id-012345678901234567890";
const DEVICE_C = "device-c-test-id-012345678901234567890";

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

async function cleanupDevices() {
  await db.delete(schema.authorizedDevices);
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, SEED_IDS.staffA));
}

describe("device authorization service", () => {
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

    await cleanupDevices();
    await setDeviceAuthEnabled(true);
  });

  after(async () => {
    await cleanupDevices();
    await setDeviceAuthEnabled(false);
    bindTestDatabase(null);
    if (disposeProxy) {
      await disposeProxy();
    }
  });

  it("allows staff login when device authorization is disabled", async () => {
    await setDeviceAuthEnabled(false);
    const hash = await hashDeviceId(DEVICE_A);
    const result = await evaluateStaffDeviceLogin(staffUser, hash, {
      ipAddress: "127.0.0.1",
      userAgent: "test-agent",
    });
    assert.equal(result.ok, true);
    await setDeviceAuthEnabled(true);
  });

  it("blocks new staff device with pending record", async () => {
    const hash = await hashDeviceId(DEVICE_A);
    const result = await evaluateStaffDeviceLogin(staffUser, hash, {
      ipAddress: "127.0.0.1",
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/120",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "new_pending");
    }

    const rows = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.userId, SEED_IDS.staffA));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "pending");
  });

  it("allows staff login after admin approval", async () => {
    const hash = await hashDeviceId(DEVICE_A);
    const pending = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.deviceIdHash, hash))
      .limit(1);
    assert.ok(pending[0]);

    await approveAuthorizedDevice(adminUser, pending[0]!.id, {
      ipAddress: "127.0.0.1",
      userAgent: "admin-agent",
    });

    const result = await evaluateStaffDeviceLogin(staffUser, hash, {
      ipAddress: "127.0.0.1",
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/120",
    });
    assert.equal(result.ok, true);
  });

  it("records admin device as approved without blocking", async () => {
    const hash = await hashDeviceId("admin-device-test-1234567890");
    const recordId = await recordAdminDeviceOnLogin(adminUser, hash, {
      ipAddress: "127.0.0.1",
      userAgent: "admin-mac-chrome",
    });
    const row = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.id, recordId))
      .limit(1);
    assert.equal(row[0]?.status, "approved");
  });

  it("blocks third device when staff already has two approved", async () => {
    const hashB = await hashDeviceId(DEVICE_B);
    const hashC = await hashDeviceId(DEVICE_C);

    await db.insert(schema.authorizedDevices).values({
      id: crypto.randomUUID(),
      userId: SEED_IDS.staffA,
      deviceIdHash: hashB,
      deviceName: "Device B",
      status: "approved",
      approvedBy: SEED_IDS.admin,
      approvedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await evaluateStaffDeviceLogin(staffUser, hashC, {
      ipAddress: "10.0.0.2",
      userAgent: "Mozilla/5.0 (iPhone) Safari/604.1",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "limit_reached");
    }
  });

  it("rejects approve when staff device limit reached", async () => {
    const hashC = await hashDeviceId(DEVICE_C);
    const pendingRows = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.status, "pending"));
    const pending = pendingRows.find((row) => row.deviceIdHash === hashC);
    assert.ok(pending);

    await assert.rejects(
      () =>
        approveAuthorizedDevice(adminUser, pending!.id, {
          ipAddress: "127.0.0.1",
          userAgent: "admin-agent",
        }),
      (error: unknown) => {
        assert.ok(error instanceof DeviceAdminError);
        assert.equal(error.code, "limit_reached");
        return true;
      },
    );
  });

  it("revokes device sessions on device revoke", async () => {
    const hash = await hashDeviceId(DEVICE_A);
    const device = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.deviceIdHash, hash))
      .limit(1);
    assert.ok(device[0]);

    const request = new Request("https://crm.example/login", {
      headers: { "user-agent": "test" },
    });
    const { token } = await createSession(SEED_IDS.staffA, request, hash);
    const validBefore = await validateSessionToken(token, { touch: false });
    assert.equal(validBefore.ok, true);

    await revokeAuthorizedDevice(adminUser, device[0]!.id, {
      ipAddress: "127.0.0.1",
      userAgent: "admin-agent",
    });

    const validAfter = await validateSessionToken(token, { touch: false });
    assert.equal(validAfter.ok, false);
    if (!validAfter.ok) {
      assert.equal(validAfter.reason, "device_revoked");
    }

    const approved = await isDeviceApprovedForSession(SEED_IDS.staffA, hash);
    assert.equal(approved, false);
  });

  // --- Reapproval flow tests ---

  it("re-login with revoked device resets status to pending and blocks login", async () => {
    // Device A is revoked from the previous test.
    const hash = await hashDeviceId(DEVICE_A);

    const result = await evaluateStaffDeviceLogin(staffUser, hash, {
      ipAddress: "10.0.0.5",
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/121",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "reapproval_pending");
      assert.equal(result.errorCode, "DEVICE_REAPPROVAL_PENDING");
    }

    const row = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.deviceIdHash, hash))
      .limit(1);
    assert.ok(row[0]);
    assert.equal(row[0]!.status, "pending");
    assert.equal(row[0]!.approvedBy, null);
    assert.equal(row[0]!.approvedAt, null);
    assert.equal(row[0]!.revokedAt, null);
  });

  it("re-login with pending device (after reapply) keeps status pending", async () => {
    const hash = await hashDeviceId(DEVICE_A);

    const result = await evaluateStaffDeviceLogin(staffUser, hash, {
      ipAddress: "10.0.0.5",
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/121",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "pending");
      assert.equal(result.errorCode, "DEVICE_PENDING_REVIEW");
    }

    const row = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.deviceIdHash, hash))
      .limit(1);
    assert.equal(row[0]!.status, "pending");
  });

  it("admin can re-approve a reapplied device and staff can login", async () => {
    const hash = await hashDeviceId(DEVICE_A);
    const row = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.deviceIdHash, hash))
      .limit(1);
    assert.ok(row[0]);
    assert.equal(row[0]!.status, "pending");

    // Admin re-approves (need to free up the slot first: device B is still approved)
    // Revoke device B to make room
    const hashB = await hashDeviceId(DEVICE_B);
    const deviceB = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.deviceIdHash, hashB))
      .limit(1);
    if (deviceB[0]?.status === "approved") {
      await revokeAuthorizedDevice(adminUser, deviceB[0]!.id, {
        ipAddress: "127.0.0.1",
        userAgent: "admin-agent",
      });
    }

    await approveAuthorizedDevice(adminUser, row[0]!.id, {
      ipAddress: "127.0.0.1",
      userAgent: "admin-agent",
    });

    const result = await evaluateStaffDeviceLogin(staffUser, hash, {
      ipAddress: "10.0.0.5",
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/121",
    });
    assert.equal(result.ok, true);
  });

  it("re-login with rejected device resets status to pending", async () => {
    // Use device C which is in pending state from earlier test. Reject it first.
    const hashC = await hashDeviceId(DEVICE_C);
    const deviceC = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.deviceIdHash, hashC))
      .limit(1);
    assert.ok(deviceC[0]);

    if (deviceC[0]!.status === "pending") {
      await rejectAuthorizedDevice(adminUser, deviceC[0]!.id, {
        ipAddress: "127.0.0.1",
        userAgent: "admin-agent",
      });
    }

    const afterReject = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.deviceIdHash, hashC))
      .limit(1);
    assert.equal(afterReject[0]!.status, "rejected");

    // Staff re-login with rejected device
    const result = await evaluateStaffDeviceLogin(staffUser, hashC, {
      ipAddress: "10.0.0.6",
      userAgent: "Mozilla/5.0 (iPhone) Safari/17",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "reapproval_pending");
      assert.equal(result.errorCode, "DEVICE_REAPPROVAL_PENDING");
    }

    const afterReapply = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.deviceIdHash, hashC))
      .limit(1);
    assert.equal(afterReapply[0]!.status, "pending");
    assert.equal(afterReapply[0]!.approvedAt, null);
  });

  // --- Admin bypass tests ---

  it("admin session remains valid even when admin device record is revoked", async () => {
    const adminDeviceId = "admin-device-revoke-test-1234567890";
    const hash = await hashDeviceId(adminDeviceId);

    const deviceRecordId = await recordAdminDeviceOnLogin(adminUser, hash, {
      ipAddress: "10.10.0.1",
      userAgent: "AdminBrowser/1.0",
    });

    const request = new Request("https://crm.example/login", {
      headers: { "user-agent": "AdminBrowser/1.0" },
    });
    const { token } = await createSession(adminUser.id, request, hash);

    const validBefore = await validateSessionToken(token, { touch: false });
    assert.equal(validBefore.ok, true);

    // Revoke the admin device record
    await revokeAuthorizedDevice(adminUser, deviceRecordId, {
      ipAddress: "10.10.0.1",
      userAgent: "AdminBrowser/1.0",
    });

    // Admin session must NOT be invalidated by device revocation
    const validAfter = await validateSessionToken(token, { touch: false });
    assert.equal(validAfter.ok, true);

    // Cleanup admin session
    await db
      .delete(schema.sessions)
      .where(
        and(
          eq(schema.sessions.userId, adminUser.id),
          eq(schema.sessions.deviceIdHash, hash),
        ),
      );
  });

  it("admin login records device but is never blocked regardless of feature flag", async () => {
    await setDeviceAuthEnabled(true);
    const hash = await hashDeviceId("admin-no-block-device-99999");

    const recordId = await recordAdminDeviceOnLogin(adminUser, hash, {
      ipAddress: "127.0.0.1",
      userAgent: "AdminChrome",
    });

    const row = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.id, recordId))
      .limit(1);
    assert.equal(row[0]?.status, "approved");
  });
});
