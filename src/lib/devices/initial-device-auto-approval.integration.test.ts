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
  rejectAuthorizedDevice,
  revokeAuthorizedDevice,
} from "@/lib/devices/service";
import {
  createUserAccount,
  resetUserPassword,
} from "@/lib/users-admin/service";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;

const TEMP_PASSWORD = "TempPass1";
const DEVICE_X = "eligibility-device-x-01234567890123456789";
const DEVICE_Y = "eligibility-device-y-01234567890123456789";

const createdUserIds: string[] = [];

async function loadUser(id: string): Promise<User> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  assert.ok(rows[0], `user ${id} missing`);
  return rows[0]!;
}

async function setEligibility(userId: string, value: 0 | 1) {
  await db
    .update(schema.users)
    .set({
      initialDeviceAutoApprovalEligible: value,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.users.id, userId));
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

describe("initial_device_auto_approval_eligible lifecycle", () => {
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

  it("migration column exists; existing seed users default to 0", async () => {
    const seedStaff = await loadUser(SEED_IDS.staffA);
    assert.equal(typeof seedStaff.initialDeviceAutoApprovalEligible, "number");
    assert.equal(seedStaff.initialDeviceAutoApprovalEligible, 0);
    const seedAdmin = await loadUser(SEED_IDS.admin);
    assert.equal(seedAdmin.initialDeviceAutoApprovalEligible, 0);

    // Insert without explicit eligibility; DB/schema default must be 0.
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    createdUserIds.push(id);
    await db.insert(schema.users).values({
      id,
      email: `elig-default-${Date.now()}@crm.local`,
      displayName: "Default Elig",
      passwordHash: "x",
      role: "staff",
      isActive: 1,
      failedLoginAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    const inserted = await loadUser(id);
    assert.equal(inserted.initialDeviceAutoApprovalEligible, 0);
  });

  it("creates Staff with mustChangePassword=1 and eligibility=1", async () => {
    const email = `elig-staff-${Date.now()}@crm.local`;
    const { id } = await createUserAccount(adminUser, {
      name: "Elig Staff",
      email,
      role: "staff",
      temporaryPassword: TEMP_PASSWORD,
    });
    createdUserIds.push(id);

    const user = await loadUser(id);
    assert.equal(user.role, "staff");
    assert.equal(user.mustChangePassword, 1);
    assert.equal(user.initialDeviceAutoApprovalEligible, 1);
  });

  it("creates Admin with eligibility=0", async () => {
    const email = `elig-admin-${Date.now()}@crm.local`;
    const { id } = await createUserAccount(adminUser, {
      name: "Elig Admin",
      email,
      role: "admin",
      temporaryPassword: TEMP_PASSWORD,
      confirmAdminRole: true,
    });
    createdUserIds.push(id);

    const user = await loadUser(id);
    assert.equal(user.role, "admin");
    assert.equal(user.mustChangePassword, 0);
    assert.equal(user.initialDeviceAutoApprovalEligible, 0);
  });

  it("Admin Reset Password preserves eligibility 0 and 1", async () => {
    const email0 = `elig-reset0-${Date.now()}@crm.local`;
    const { id: id0 } = await createUserAccount(adminUser, {
      name: "Reset Zero",
      email: email0,
      role: "staff",
      temporaryPassword: TEMP_PASSWORD,
    });
    createdUserIds.push(id0);
    await setEligibility(id0, 0);

    await resetUserPassword(adminUser, id0, "ResetPass1", {
      ipAddress: "127.0.0.1",
      userAgent: "test",
    });
    assert.equal((await loadUser(id0)).initialDeviceAutoApprovalEligible, 0);
    assert.equal((await loadUser(id0)).mustChangePassword, 1);

    const email1 = `elig-reset1-${Date.now()}@crm.local`;
    const { id: id1 } = await createUserAccount(adminUser, {
      name: "Reset One",
      email: email1,
      role: "staff",
      temporaryPassword: TEMP_PASSWORD,
    });
    createdUserIds.push(id1);
    assert.equal((await loadUser(id1)).initialDeviceAutoApprovalEligible, 1);

    await resetUserPassword(adminUser, id1, "ResetPass1", {
      ipAddress: "127.0.0.1",
      userAgent: "test",
    });
    assert.equal((await loadUser(id1)).initialDeviceAutoApprovalEligible, 1);
    assert.equal((await loadUser(id1)).mustChangePassword, 1);
  });

  it("manual approve consumes eligibility atomically", async () => {
    const email = `elig-approve-${Date.now()}@crm.local`;
    const { id } = await createUserAccount(adminUser, {
      name: "Approve Staff",
      email,
      role: "staff",
      temporaryPassword: TEMP_PASSWORD,
    });
    createdUserIds.push(id);
    const staff = await loadUser(id);
    assert.equal(staff.initialDeviceAutoApprovalEligible, 1);

    const hash = await hashDeviceId(DEVICE_X);
    const login = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.0.0.1",
      userAgent: "Chrome",
    });
    // Eligible first-device Staff may receive a restricted session allow.
    assert.equal(login.ok, true);
    assert.ok(login.deviceRecordId);
    const pendingRow = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.id, login.deviceRecordId))
      .limit(1);
    assert.equal(pendingRow[0]?.status, "pending");

    await approveAuthorizedDevice(adminUser, login.deviceRecordId, {
      ipAddress: "127.0.0.1",
      userAgent: "admin",
    });

    const after = await loadUser(id);
    assert.equal(after.initialDeviceAutoApprovalEligible, 0);

    const device = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.userId, id))
      .limit(1);
    assert.equal(device[0]?.status, "approved");

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "device.approved"));
    assert.ok(
      audits.some((row) => row.entityId === device[0]?.id),
      "device.approved audit missing",
    );
  });

  it("approve failure leaves eligibility unchanged", async () => {
    const email = `elig-limit-${Date.now()}@crm.local`;
    const { id } = await createUserAccount(adminUser, {
      name: "Limit Staff",
      email,
      role: "staff",
      temporaryPassword: TEMP_PASSWORD,
    });
    createdUserIds.push(id);
    let staff = await loadUser(id);

    const hashA = await hashDeviceId(`${DEVICE_X}-a`);
    const hashB = await hashDeviceId(`${DEVICE_X}-b`);
    const hashC = await hashDeviceId(`${DEVICE_X}-c`);

    for (const hash of [hashA, hashB]) {
      staff = await loadUser(id);
      const result = await evaluateStaffDeviceLogin(staff, hash, {
        ipAddress: "10.0.0.2",
        userAgent: "Chrome",
      });
      assert.ok(result.deviceRecordId);
      await approveAuthorizedDevice(adminUser, result.deviceRecordId, {
        ipAddress: "127.0.0.1",
        userAgent: "admin",
      });
    }

    assert.equal((await loadUser(id)).initialDeviceAutoApprovalEligible, 0);
    await setEligibility(id, 1);

    const third = await evaluateStaffDeviceLogin(await loadUser(id), hashC, {
      ipAddress: "10.0.0.3",
      userAgent: "Safari",
    });
    assert.equal(third.ok, false);
    if (!third.ok) {
      assert.equal(third.reason, "limit_reached");
      assert.ok(third.deviceRecordId);
      await assert.rejects(
        () =>
          approveAuthorizedDevice(adminUser, third.deviceRecordId!, {
            ipAddress: "127.0.0.1",
            userAgent: "admin",
          }),
        (error: unknown) => {
          assert.ok(error instanceof DeviceAdminError);
          assert.equal(error.code, "limit_reached");
          return true;
        },
      );
    }

    assert.equal((await loadUser(id)).initialDeviceAutoApprovalEligible, 1);

    await assert.rejects(
      () =>
        approveAuthorizedDevice(adminUser, crypto.randomUUID(), {
          ipAddress: "127.0.0.1",
          userAgent: "admin",
        }),
      (error: unknown) => {
        assert.ok(error instanceof DeviceAdminError);
        assert.equal(error.code, "not_found");
        return true;
      },
    );
    assert.equal((await loadUser(id)).initialDeviceAutoApprovalEligible, 1);
  });

  it("reject consumes eligibility; reapproval does not restore it", async () => {
    const email = `elig-reject-${Date.now()}@crm.local`;
    const { id } = await createUserAccount(adminUser, {
      name: "Reject Staff",
      email,
      role: "staff",
      temporaryPassword: TEMP_PASSWORD,
    });
    createdUserIds.push(id);
    let staff = await loadUser(id);
    assert.equal(staff.initialDeviceAutoApprovalEligible, 1);

    const hash = await hashDeviceId(DEVICE_Y);
    const pending = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.0.1.1",
      userAgent: "Chrome",
    });
    assert.equal(pending.ok, true);
    assert.ok(pending.deviceRecordId);
    await rejectAuthorizedDevice(adminUser, pending.deviceRecordId, {
      ipAddress: "127.0.0.1",
      userAgent: "admin",
    });

    staff = await loadUser(id);
    assert.equal(staff.initialDeviceAutoApprovalEligible, 0);

    const reapply = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.0.1.2",
      userAgent: "Chrome",
    });
    assert.equal(reapply.ok, false);
    if (!reapply.ok) {
      assert.equal(reapply.reason, "reapproval_pending");
    }
    assert.equal((await loadUser(id)).initialDeviceAutoApprovalEligible, 0);
  });

  it("revoke keeps eligibility at 0; reapproval does not restore it", async () => {
    const email = `elig-revoke-${Date.now()}@crm.local`;
    const { id } = await createUserAccount(adminUser, {
      name: "Revoke Staff",
      email,
      role: "staff",
      temporaryPassword: TEMP_PASSWORD,
    });
    createdUserIds.push(id);
    let staff = await loadUser(id);

    const hash = await hashDeviceId(`${DEVICE_Y}-rev`);
    const pending = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.0.2.1",
      userAgent: "Chrome",
    });
    assert.equal(pending.ok, true);
    assert.ok(pending.deviceRecordId);
    await approveAuthorizedDevice(adminUser, pending.deviceRecordId, {
      ipAddress: "127.0.0.1",
      userAgent: "admin",
    });
    assert.equal((await loadUser(id)).initialDeviceAutoApprovalEligible, 0);

    const device = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.userId, id))
      .limit(1);
    assert.equal(device[0]?.status, "approved");

    await revokeAuthorizedDevice(adminUser, device[0]!.id, {
      ipAddress: "127.0.0.1",
      userAgent: "admin",
    });
    assert.equal((await loadUser(id)).initialDeviceAutoApprovalEligible, 0);

    staff = await loadUser(id);
    const reapply = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.0.2.2",
      userAgent: "Chrome",
    });
    assert.equal(reapply.ok, false);
    if (!reapply.ok) {
      assert.equal(reapply.reason, "reapproval_pending");
    }
    assert.equal((await loadUser(id)).initialDeviceAutoApprovalEligible, 0);
  });

  it("duplicate approve on already-approved does not restore eligibility", async () => {
    const email = `elig-dup-${Date.now()}@crm.local`;
    const { id } = await createUserAccount(adminUser, {
      name: "Dup Approve",
      email,
      role: "staff",
      temporaryPassword: TEMP_PASSWORD,
    });
    createdUserIds.push(id);
    const staff = await loadUser(id);
    const hash = await hashDeviceId(`${DEVICE_Y}-dup`);
    const pending = await evaluateStaffDeviceLogin(staff, hash, {
      ipAddress: "10.0.3.1",
      userAgent: "Chrome",
    });
    assert.equal(pending.ok, true);
    assert.ok(pending.deviceRecordId);
    await approveAuthorizedDevice(adminUser, pending.deviceRecordId, {
      ipAddress: "127.0.0.1",
      userAgent: "admin",
    });
    assert.equal((await loadUser(id)).initialDeviceAutoApprovalEligible, 0);

    await assert.rejects(
      () =>
        approveAuthorizedDevice(adminUser, pending.deviceRecordId, {
          ipAddress: "127.0.0.1",
          userAgent: "admin",
        }),
      (error: unknown) => {
        assert.ok(error instanceof DeviceAdminError);
        assert.equal(error.code, "invalid_status");
        return true;
      },
    );
    assert.equal((await loadUser(id)).initialDeviceAutoApprovalEligible, 0);
  });
});
