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
  approvePendingDeviceWithReplacement,
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

async function setDeviceLimit(limit: number) {
  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(schema.systemSettings)
    .where(
      eq(schema.systemSettings.key, "device_authorization_limit_per_user"),
    )
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(schema.systemSettings)
      .set({ value: String(limit), updatedAt: now })
      .where(
        eq(schema.systemSettings.key, "device_authorization_limit_per_user"),
      );
  } else {
    await db.insert(schema.systemSettings).values({
      key: "device_authorization_limit_per_user",
      value: String(limit),
      updatedAt: now,
    });
  }
}

async function insertDevice(input: {
  userId: string;
  deviceIdHash: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  createdAt?: string;
  approvedAt?: string | null;
  lastSeenAt?: string | null;
}) {
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    userId: input.userId,
    deviceIdHash: input.deviceIdHash,
    deviceName: input.deviceIdHash,
    userAgent: `Test/${input.deviceIdHash}`,
    ipAddress: "127.0.0.1",
    status: input.status,
    approvedBy: input.status === "approved" ? SEED_IDS.admin : null,
    approvedAt: input.approvedAt ?? null,
    revokedAt: input.status === "revoked" ? now : null,
    lastSeenAt: input.lastSeenAt ?? null,
    lastSeenIp: "127.0.0.1",
    lastSeenUserAgent: `Test/${input.deviceIdHash}`,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  } as const;
  await db.insert(schema.authorizedDevices).values(row);
  return (
    await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.id, row.id))
      .limit(1)
  )[0]!;
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

  it("approves normally when capacity becomes available before confirmation", async () => {
    await cleanupDevices();
    await setDeviceLimit(3);
    try {
      const oldA = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-capacity-a"),
        status: "approved",
      });
      await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-capacity-b"),
        status: "approved",
      });
      const pending = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-capacity-new"),
        status: "pending",
      });

      await approvePendingDeviceWithReplacement(
        adminUser,
        pending.id,
        oldA.id,
        { ipAddress: "127.0.0.1", userAgent: "admin-agent" },
      );

      const rows = await db
        .select()
        .from(schema.authorizedDevices)
        .where(eq(schema.authorizedDevices.userId, staffUser.id));
      assert.equal(
        rows.filter((row) => row.status === "approved").length,
        3,
      );
      assert.equal(
        rows.find((row) => row.id === oldA.id)?.status,
        "approved",
      );
    } finally {
      await cleanupDevices();
      await setDeviceLimit(2);
    }
  });

  it("atomically replaces one full-limit device and revokes only its sessions", async () => {
    await cleanupDevices();
    await setDeviceLimit(3);
    try {
      const oldA = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-full-a"),
        status: "approved",
        lastSeenAt: "2026-08-01T00:00:00.000Z",
      });
      const oldB = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-full-b"),
        status: "approved",
        lastSeenAt: "2026-08-08T00:00:00.000Z",
      });
      await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-full-c"),
        status: "approved",
        lastSeenAt: "2026-08-12T00:00:00.000Z",
      });
      const pending = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-full-new"),
        status: "pending",
      });

      const request = new Request("https://crm.example/login", {
        headers: { "user-agent": "test" },
      });
      const oldToken = await createSession(
        staffUser.id,
        request,
        oldA.deviceIdHash,
      );
      const otherToken = await createSession(
        staffUser.id,
        request,
        oldB.deviceIdHash,
      );

      await approvePendingDeviceWithReplacement(
        adminUser,
        pending.id,
        oldA.id,
        { ipAddress: "127.0.0.1", userAgent: "admin-agent" },
      );

      const rows = await db
        .select()
        .from(schema.authorizedDevices)
        .where(eq(schema.authorizedDevices.userId, staffUser.id));
      assert.equal(
        rows.filter((row) => row.status === "approved").length,
        3,
      );
      assert.equal(rows.find((row) => row.id === oldA.id)?.status, "revoked");
      assert.equal(rows.find((row) => row.id === pending.id)?.status, "approved");

      const replacedSession = await validateSessionToken(oldToken.token, {
        touch: false,
      });
      assert.equal(replacedSession.ok, false);
      const unaffectedSession = await validateSessionToken(otherToken.token, {
        touch: false,
      });
      assert.equal(unaffectedSession.ok, true);

      const replacementAudit = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, "device.authorization.replaced"));
      assert.ok(
        replacementAudit.some((row) =>
          row.metadata?.includes(`"replacementDeviceRecordId":"${oldA.id}"`),
        ),
      );
    } finally {
      await cleanupDevices();
      await setDeviceLimit(2);
    }
  });

  it("allows the Admin to choose a different replacement device", async () => {
    await cleanupDevices();
    await setDeviceLimit(3);
    try {
      const oldA = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-choice-a"),
        status: "approved",
      });
      const oldB = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-choice-b"),
        status: "approved",
      });
      await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-choice-c"),
        status: "approved",
      });
      const pending = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("replace-choice-new"),
        status: "pending",
      });

      await approvePendingDeviceWithReplacement(
        adminUser,
        pending.id,
        oldB.id,
        { ipAddress: "127.0.0.1", userAgent: "admin-agent" },
      );
      const rows = await db
        .select()
        .from(schema.authorizedDevices)
        .where(eq(schema.authorizedDevices.userId, staffUser.id));
      assert.equal(rows.find((row) => row.id === oldA.id)?.status, "approved");
      assert.equal(rows.find((row) => row.id === oldB.id)?.status, "revoked");
    } finally {
      await cleanupDevices();
      await setDeviceLimit(2);
    }
  });

  it("rejects a replacement from another Staff without mutation", async () => {
    await cleanupDevices();
    await setDeviceLimit(3);
    try {
      const oldDevices = await Promise.all(
        ["cross-a", "cross-b", "cross-c"].map(async (id) =>
          insertDevice({
            userId: staffUser.id,
            deviceIdHash: await hashDeviceId(id),
            status: "approved",
          }),
        ),
      );
      const pending = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("cross-new"),
        status: "pending",
      });
      const otherStaff = (
        await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, SEED_IDS.staffB))
          .limit(1)
      )[0];
      assert.ok(otherStaff);
      const otherDevice = await insertDevice({
        userId: otherStaff.id,
        deviceIdHash: await hashDeviceId("cross-other"),
        status: "approved",
      });

      await assert.rejects(
        () =>
          approvePendingDeviceWithReplacement(
            adminUser,
            pending.id,
            otherDevice.id,
            { ipAddress: null, userAgent: null },
          ),
        (error: unknown) => {
          assert.ok(error instanceof DeviceAdminError);
          assert.equal(error.code, "replacement_conflict");
          return true;
        },
      );
      const rows = await db
        .select()
        .from(schema.authorizedDevices)
        .where(eq(schema.authorizedDevices.userId, staffUser.id));
      assert.equal(rows.filter((row) => row.status === "approved").length, 3);
      assert.equal(rows.find((row) => row.id === pending.id)?.status, "pending");
      assert.equal(oldDevices.length, 3);
    } finally {
      await cleanupDevices();
      await setDeviceLimit(2);
    }
  });

  it("returns conflict when the selected replacement is no longer approved", async () => {
    await cleanupDevices();
    await setDeviceLimit(3);
    try {
      const old = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("stale-replacement"),
        status: "revoked",
      });
      await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("stale-b"),
        status: "approved",
      });
      await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("stale-c"),
        status: "approved",
      });
      await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("stale-d"),
        status: "approved",
      });
      const pending = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("stale-new"),
        status: "pending",
      });

      await assert.rejects(
        () =>
          approvePendingDeviceWithReplacement(
            adminUser,
            pending.id,
            old.id,
            { ipAddress: null, userAgent: null },
          ),
        (error: unknown) => {
          assert.ok(error instanceof DeviceAdminError);
          assert.equal(error.code, "replacement_conflict");
          return true;
        },
      );
      const pendingRow = await db
        .select()
        .from(schema.authorizedDevices)
        .where(eq(schema.authorizedDevices.id, pending.id))
        .limit(1);
      assert.equal(pendingRow[0]?.status, "pending");
    } finally {
      await cleanupDevices();
      await setDeviceLimit(2);
    }
  });

  it("approves safely when another Admin frees a slot after the sheet opens", async () => {
    await cleanupDevices();
    await setDeviceLimit(3);
    try {
      const oldA = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("race-capacity-a"),
        status: "approved",
      });
      const oldB = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("race-capacity-b"),
        status: "approved",
      });
      await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("race-capacity-c"),
        status: "approved",
      });
      const pending = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("race-capacity-new"),
        status: "pending",
      });
      await revokeAuthorizedDevice(adminUser, oldA.id, {
        ipAddress: null,
        userAgent: null,
      });

      await approvePendingDeviceWithReplacement(
        adminUser,
        pending.id,
        oldA.id,
        { ipAddress: null, userAgent: null },
      );
      const rows = await db
        .select()
        .from(schema.authorizedDevices)
        .where(eq(schema.authorizedDevices.userId, staffUser.id));
      assert.equal(rows.filter((row) => row.status === "approved").length, 3);
      assert.equal(rows.find((row) => row.id === oldB.id)?.status, "approved");
    } finally {
      await cleanupDevices();
      await setDeviceLimit(2);
    }
  });

  it("keeps the authorized count at the limit for competing approvals", async () => {
    await cleanupDevices();
    await setDeviceLimit(3);
    try {
      const replacementA = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("race-compete-a"),
        status: "approved",
      });
      const replacementB = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("race-compete-b"),
        status: "approved",
      });
      await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("race-compete-c"),
        status: "approved",
      });
      const pendingA = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("race-compete-new-a"),
        status: "pending",
      });
      const pendingB = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("race-compete-new-b"),
        status: "pending",
      });

      const results = await Promise.allSettled([
        approvePendingDeviceWithReplacement(
          adminUser,
          pendingA.id,
          replacementA.id,
          { ipAddress: null, userAgent: null },
        ),
        approvePendingDeviceWithReplacement(
          adminUser,
          pendingB.id,
          replacementB.id,
          { ipAddress: null, userAgent: null },
        ),
      ]);
      assert.ok(results.some((result) => result.status === "fulfilled"));

      const rows = await db
        .select()
        .from(schema.authorizedDevices)
        .where(eq(schema.authorizedDevices.userId, staffUser.id));
      assert.ok(rows.filter((row) => row.status === "approved").length <= 3);
    } finally {
      await cleanupDevices();
      await setDeviceLimit(2);
    }
  });

  it("rejects a pending request that was already processed", async () => {
    await cleanupDevices();
    await setDeviceLimit(3);
    try {
      const old = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("processed-old"),
        status: "approved",
      });
      const pending = await insertDevice({
        userId: staffUser.id,
        deviceIdHash: await hashDeviceId("processed-new"),
        status: "pending",
      });
      await approveAuthorizedDevice(adminUser, pending.id, {
        ipAddress: null,
        userAgent: null,
      });

      await assert.rejects(
        () =>
          approvePendingDeviceWithReplacement(
            adminUser,
            pending.id,
            old.id,
            { ipAddress: null, userAgent: null },
          ),
        (error: unknown) => {
          assert.ok(error instanceof DeviceAdminError);
          assert.equal(error.code, "invalid_status");
          return true;
        },
      );
    } finally {
      await cleanupDevices();
      await setDeviceLimit(2);
    }
  });
});
