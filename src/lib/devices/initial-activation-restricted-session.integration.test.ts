import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { hashDeviceId } from "@/lib/auth/device";
import { createSession, validateSessionToken } from "@/lib/auth/session";
import {
  approveAuthorizedDevice,
  evaluateStaffDeviceLogin,
  isDeviceAllowedForStaffSession,
  rejectAuthorizedDevice,
} from "@/lib/devices/service";
import { createUserAccount } from "@/lib/users-admin/service";
import { getPostLoginRedirectPath } from "@/lib/permissions/auth";
import { userMustChangePassword } from "@/lib/auth/change-password";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;

const TEMP_PASSWORD = "TempPass1";
const DEVICE_A = "restricted-session-device-a-01234567890123";
const DEVICE_B = "restricted-session-device-b-01234567890123";

const createdUserIds: string[] = [];

async function loadUser(id: string): Promise<User> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  assert.ok(rows[0]);
  return rows[0]!;
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

async function cleanupCreatedUsers() {
  for (const id of createdUserIds.splice(0)) {
    await db
      .delete(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.userId, id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

async function createEligibleStaff(label: string): Promise<User> {
  const email = `restricted-${label}-${Date.now()}@crm.local`;
  const { id } = await createUserAccount(adminUser, {
    name: `Restricted ${label}`,
    email,
    role: "staff",
    temporaryPassword: TEMP_PASSWORD,
  });
  createdUserIds.push(id);
  const user = await loadUser(id);
  assert.equal(user.mustChangePassword, 1);
  assert.equal(user.initialDeviceAutoApprovalEligible, 1);
  return user;
}

describe("initial activation restricted session", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    adminUser = await loadUser(SEED_IDS.admin);
    await setDeviceAuthEnabled(true);
  });

  after(async () => {
    await cleanupCreatedUsers();
    await setDeviceAuthEnabled(false);
    bindTestDatabase(null);
    if (disposeProxy) {
      await disposeProxy();
    }
  });

  it("eligible first pending login allows session; device stays pending; eligibility stays 1", async () => {
    const staff = await createEligibleStaff("first");
    const hash = await hashDeviceId(DEVICE_A);
    const deviceResult = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.1.0.1",
      userAgent: "Chrome",
    });
    assert.equal(deviceResult.ok, true);
    assert.ok(deviceResult.deviceRecordId);

    const device = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.id, deviceResult.deviceRecordId))
      .limit(1);
    assert.equal(device[0]?.status, "pending");
    assert.equal(device[0]?.approvedAt, null);
    assert.equal(device[0]?.approvedBy, null);

    const afterUser = await loadUser(staff.id);
    assert.equal(afterUser.initialDeviceAutoApprovalEligible, 1);
    assert.equal(afterUser.mustChangePassword, 1);

    const approvedAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "device.approved"),
          eq(schema.auditLogs.entityId, deviceResult.deviceRecordId),
        ),
      );
    assert.equal(approvedAudits.length, 0);

    const request = new Request("https://crm.example/login", {
      headers: { "user-agent": "Chrome" },
    });
    const { token } = await createSession(staff.id, request, hash);
    const validation = await validateSessionToken(token, { touch: false });
    assert.equal(validation.ok, true);

    assert.equal(getPostLoginRedirectPath(afterUser), "/change-password");
    assert.equal(userMustChangePassword(afterUser), true);

    const allowed = await isDeviceAllowedForStaffSession(afterUser, hash);
    assert.equal(allowed, true);
  });

  it("ineligible pending staff still receives DEVICE_PENDING / NEW_PENDING block", async () => {
    const staff = await createEligibleStaff("inelig");
    await db
      .update(schema.users)
      .set({
        initialDeviceAutoApprovalEligible: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.users.id, staff.id));
    const ineligible = await loadUser(staff.id);

    const hash = await hashDeviceId(`${DEVICE_A}-inelig`);
    const result = await evaluateStaffDeviceLogin(ineligible, hash, {
      ipAddress: "10.1.0.2",
      userAgent: "Chrome",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "new_pending");
    }
  });

  it("mustChangePassword=0 pending does not get restricted allow", async () => {
    const staff = await createEligibleStaff("nomust");
    await db
      .update(schema.users)
      .set({
        mustChangePassword: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.users.id, staff.id));
    const noMust = await loadUser(staff.id);

    const hash = await hashDeviceId(`${DEVICE_A}-nomust`);
    const result = await evaluateStaffDeviceLogin(noMust, hash, {
      ipAddress: "10.1.0.3",
      userAgent: "Chrome",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "new_pending");
    }
  });

  it("session validation fails when eligibility becomes 0 while still pending", async () => {
    const staff = await createEligibleStaff("elig0");
    const hash = await hashDeviceId(`${DEVICE_A}-elig0`);
    const deviceResult = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.1.0.4",
      userAgent: "Chrome",
    });
    assert.equal(deviceResult.ok, true);

    const request = new Request("https://crm.example/login", {
      headers: { "user-agent": "Chrome" },
    });
    const { token } = await createSession(staff.id, request, hash);
    assert.equal((await validateSessionToken(token, { touch: false })).ok, true);

    await db
      .update(schema.users)
      .set({
        initialDeviceAutoApprovalEligible: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.users.id, staff.id));

    const after = await validateSessionToken(token, { touch: false });
    assert.equal(after.ok, false);
    if (!after.ok) {
      assert.equal(after.reason, "device_revoked");
    }
  });

  it("session validation fails when mustChangePassword becomes 0 while still pending", async () => {
    const staff = await createEligibleStaff("must0");
    const hash = await hashDeviceId(`${DEVICE_A}-must0`);
    assert.equal(
      (
        await evaluateStaffDeviceLogin(staff, hash, {
          ipAddress: "10.1.0.5",
          userAgent: "Chrome",
        })
      ).ok,
      true,
    );

    const request = new Request("https://crm.example/login", {
      headers: { "user-agent": "Chrome" },
    });
    const { token } = await createSession(staff.id, request, hash);
    assert.equal((await validateSessionToken(token, { touch: false })).ok, true);

    await db
      .update(schema.users)
      .set({
        mustChangePassword: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.users.id, staff.id));

    const after = await validateSessionToken(token, { touch: false });
    assert.equal(after.ok, false);
    if (!after.ok) {
      assert.equal(after.reason, "device_revoked");
    }
  });

  it("admin approve during restricted session keeps session valid", async () => {
    const staff = await createEligibleStaff("approve-live");
    const hash = await hashDeviceId(`${DEVICE_A}-appr`);
    const deviceResult = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.1.0.6",
      userAgent: "Chrome",
    });
    assert.equal(deviceResult.ok, true);
    assert.ok(deviceResult.deviceRecordId);

    const request = new Request("https://crm.example/login", {
      headers: { "user-agent": "Chrome" },
    });
    const { token } = await createSession(staff.id, request, hash);
    assert.equal((await validateSessionToken(token, { touch: false })).ok, true);

    await approveAuthorizedDevice(adminUser, deviceResult.deviceRecordId, {
      ipAddress: "127.0.0.1",
      userAgent: "admin",
    });

    const userAfter = await loadUser(staff.id);
    assert.equal(userAfter.initialDeviceAutoApprovalEligible, 0);
    assert.equal(userAfter.mustChangePassword, 1);

    const validation = await validateSessionToken(token, { touch: false });
    assert.equal(validation.ok, true);
    assert.equal(getPostLoginRedirectPath(userAfter), "/change-password");
  });

  it("admin reject during restricted session invalidates session", async () => {
    const staff = await createEligibleStaff("reject-live");
    const hash = await hashDeviceId(`${DEVICE_A}-rej`);
    const deviceResult = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.1.0.7",
      userAgent: "Chrome",
    });
    assert.equal(deviceResult.ok, true);
    assert.ok(deviceResult.deviceRecordId);

    const request = new Request("https://crm.example/login", {
      headers: { "user-agent": "Chrome" },
    });
    const { token } = await createSession(staff.id, request, hash);
    assert.equal((await validateSessionToken(token, { touch: false })).ok, true);

    await rejectAuthorizedDevice(adminUser, deviceResult.deviceRecordId, {
      ipAddress: "127.0.0.1",
      userAgent: "admin",
    });

    const after = await validateSessionToken(token, { touch: false });
    assert.equal(after.ok, false);
    if (!after.ok) {
      assert.equal(after.reason, "device_revoked");
    }
  });

  it("two devices login: only latest session valid; both devices pending; approved count 0", async () => {
    const staff = await createEligibleStaff("two-dev");
    const hashA = await hashDeviceId(DEVICE_A);
    const hashB = await hashDeviceId(DEVICE_B);

    const first = await evaluateStaffDeviceLogin(staff, hashA, {
      ipAddress: "10.1.1.1",
      userAgent: "Chrome-A",
    });
    assert.equal(first.ok, true);

    const requestA = new Request("https://crm.example/login", {
      headers: { "user-agent": "Chrome-A" },
    });
    const { token: tokenA } = await createSession(staff.id, requestA, hashA);
    assert.equal((await validateSessionToken(tokenA, { touch: false })).ok, true);

    const staffReload = await loadUser(staff.id);
    const second = await evaluateStaffDeviceLogin(staffReload, hashB, {
      ipAddress: "10.1.1.2",
      userAgent: "Chrome-B",
    });
    assert.equal(second.ok, true);

    const requestB = new Request("https://crm.example/login", {
      headers: { "user-agent": "Chrome-B" },
    });
    const { token: tokenB } = await createSession(staff.id, requestB, hashB);

    assert.equal((await validateSessionToken(tokenA, { touch: false })).ok, false);
    assert.equal((await validateSessionToken(tokenB, { touch: false })).ok, true);

    const devices = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.userId, staff.id));
    assert.equal(devices.length, 2);
    assert.ok(devices.every((row) => row.status === "pending"));

    const approved = await db
      .select()
      .from(schema.authorizedDevices)
      .where(
        and(
          eq(schema.authorizedDevices.userId, staff.id),
          eq(schema.authorizedDevices.status, "approved"),
        ),
      );
    assert.equal(approved.length, 0);

    const activeSessions = await db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.userId, staff.id),
          isNull(schema.sessions.revokedAt),
        ),
      );
    assert.equal(activeSessions.length, 1);
    assert.equal(activeSessions[0]?.deviceIdHash, hashB);
  });

  it("repeat login same device does not duplicate device rows", async () => {
    const staff = await createEligibleStaff("repeat");
    const hash = await hashDeviceId(`${DEVICE_A}-repeat`);

    const first = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.1.2.1",
      userAgent: "Chrome",
    });
    assert.equal(first.ok, true);

    const second = await evaluateStaffDeviceLogin(await loadUser(staff.id), hash, {
      ipAddress: "10.1.2.2",
      userAgent: "Chrome",
    });
    assert.equal(second.ok, true);
    assert.equal(second.deviceRecordId, first.deviceRecordId);

    const rows = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.userId, staff.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "pending");
  });
});
