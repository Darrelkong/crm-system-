import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
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
});
