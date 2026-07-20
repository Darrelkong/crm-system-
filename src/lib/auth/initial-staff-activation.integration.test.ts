import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { hashDeviceId } from "@/lib/auth/device";
import {
  createSession,
  validateSessionToken,
} from "@/lib/auth/session";
import {
  completeForcedPasswordChangeConsumingEligibility,
  completeInitialStaffActivation,
  InitialActivationConflictError,
} from "@/lib/auth/initial-staff-activation";
import {
  approveAuthorizedDevice,
  evaluateStaffDeviceLogin,
  rejectAuthorizedDevice,
} from "@/lib/devices/service";
import { createUserAccount } from "@/lib/users-admin/service";
import { DEVICE_AUDIT_ACTIONS } from "@/lib/devices/constants";
import { countApprovedDevicesForUser } from "@/lib/devices/queries";
import { SEED_IDS } from "@/lib/constants/seed-ids";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;

const TEMP_PASSWORD = "TempPass1";
const NEW_PASSWORD = "NewPass12";
const DEVICE_A = "activation-device-a-012345678901234567";
const DEVICE_B = "activation-device-b-012345678901234567";

const TRIGGER_DEVICE_AUDIT =
  "fail_initial_activation_device_audit_crm_test";
const TRIGGER_PASSWORD_AUDIT =
  "fail_initial_activation_password_audit_crm_test";

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

async function dropAuditFailTriggers() {
  await db.run(sql.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_DEVICE_AUDIT}`));
  await db.run(sql.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_PASSWORD_AUDIT}`));
}

async function installDeviceAuditFailTrigger() {
  await dropAuditFailTriggers();
  await db.run(
    sql.raw(`
      CREATE TRIGGER ${TRIGGER_DEVICE_AUDIT}
      BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'device.approved.initial_activation'
      BEGIN
        SELECT RAISE(ABORT, 'forced audit failure');
      END;
    `),
  );
}

async function installPasswordAuditFailTrigger() {
  await dropAuditFailTriggers();
  await db.run(
    sql.raw(`
      CREATE TRIGGER ${TRIGGER_PASSWORD_AUDIT}
      BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'auth.password_changed'
      BEGIN
        SELECT RAISE(ABORT, 'forced audit failure');
      END;
    `),
  );
}

async function cleanupCreatedUsers() {
  for (const id of createdUserIds.splice(0)) {
    await db
      .delete(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.userId, id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.userId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

async function createEligibleStaff(label: string): Promise<User> {
  const email = `activate-${label}-${Date.now()}@crm.local`;
  const { id } = await createUserAccount(adminUser, {
    name: `Activate ${label}`,
    email,
    role: "staff",
    temporaryPassword: TEMP_PASSWORD,
  });
  createdUserIds.push(id);
  return loadUser(id);
}

async function openRestrictedSession(staff: User, deviceRaw: string) {
  const hash = await hashDeviceId(deviceRaw);
  const gate = await evaluateStaffDeviceLogin(staff, hash, {
    ipAddress: "10.2.0.1",
    userAgent: "Chrome",
  });
  assert.equal(gate.ok, true);
  const request = new Request("https://crm.example/login", {
    headers: { "user-agent": "Chrome" },
  });
  const { token, sessionId } = await createSession(staff.id, request, hash);
  const validation = await validateSessionToken(token, { touch: false });
  assert.equal(validation.ok, true);
  return { token, sessionId, hash, deviceRecordId: gate.deviceRecordId };
}

async function countAudits(
  userId: string,
  action: string,
  createdAt?: string,
) {
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.userId, userId),
        eq(schema.auditLogs.action, action),
        ...(createdAt
          ? [eq(schema.auditLogs.createdAt, createdAt)]
          : []),
      ),
    );
  return rows;
}

describe("completeInitialStaffActivation", () => {
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
    await dropAuditFailTriggers();
  });

  after(async () => {
    await dropAuditFailTriggers();
    await cleanupCreatedUsers();
    await setDeviceAuthEnabled(false);
    bindTestDatabase(null);
    if (disposeProxy) {
      await disposeProxy();
    }
  });

  it("succeeds: password, eligibility, device approved, session revoked, audits", async () => {
    const staff = await createEligibleStaff("ok");
    const { token, sessionId, hash } = await openRestrictedSession(
      staff,
      DEVICE_A,
    );
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(NEW_PASSWORD);

    const result = await completeInitialStaffActivation({
      userId: staff.id,
      sessionId,
      deviceIdHash: hash,
      passwordHash,
      now,
      ipAddress: "10.2.0.1",
      userAgent: "Chrome",
    });
    assert.ok(result.deviceRecordId);

    const after = await loadUser(staff.id);
    assert.equal(after.mustChangePassword, 0);
    assert.equal(after.initialDeviceAutoApprovalEligible, 0);
    assert.equal(after.passwordChangedAt, now);
    assert.equal(await verifyPassword(NEW_PASSWORD, after.passwordHash), true);
    assert.equal(await verifyPassword(TEMP_PASSWORD, after.passwordHash), false);

    const device = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.id, result.deviceRecordId))
      .limit(1);
    assert.equal(device[0]?.status, "approved");
    assert.equal(device[0]?.approvedAt, now);
    assert.equal(device[0]?.approvedBy, null);
    assert.equal(await countApprovedDevicesForUser(staff.id), 1);

    const sessionRows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    assert.equal(sessionRows[0]?.revokedAt, now);

    const sessionCheck = await validateSessionToken(token, { touch: false });
    assert.equal(sessionCheck.ok, false);

    const passwordAudits = await countAudits(
      staff.id,
      "auth.password_changed",
      now,
    );
    assert.equal(passwordAudits.length, 1);
    assert.ok(passwordAudits[0]?.metadata?.includes('"initialActivation":true'));
    assert.ok(!passwordAudits[0]?.metadata?.includes(passwordHash));
    assert.ok(!passwordAudits[0]?.metadata?.includes(NEW_PASSWORD));
    assert.ok(!passwordAudits[0]?.metadata?.includes(hash));

    const deviceAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, result.deviceRecordId),
          eq(
            schema.auditLogs.action,
            DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION,
          ),
          eq(schema.auditLogs.createdAt, now),
        ),
      );
    assert.equal(deviceAudits.length, 1);
    assert.ok(deviceAudits[0]?.metadata?.includes("initial_password_activation"));
    assert.ok(deviceAudits[0]?.metadata?.includes('"approvedAutomatically":true'));
    assert.ok(!deviceAudits[0]?.metadata?.includes(hash));
    assert.ok(!deviceAudits[0]?.metadata?.includes(passwordHash));

    const manualApproveAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, result.deviceRecordId),
          eq(schema.auditLogs.action, DEVICE_AUDIT_ACTIONS.APPROVED),
        ),
      );
    assert.equal(manualApproveAudits.length, 0);

    const reLogin = await evaluateStaffDeviceLogin(await loadUser(staff.id), hash, {
      ipAddress: "10.2.0.2",
      userAgent: "Chrome",
    });
    assert.equal(reLogin.ok, true);
  });

  it("device audit insert failure rolls back password, device, session, eligibility", async () => {
    const staff = await createEligibleStaff("dev-audit-fail");
    const before = await loadUser(staff.id);
    const { token, sessionId, hash, deviceRecordId } =
      await openRestrictedSession(staff, `${DEVICE_A}-daf`);
    assert.ok(deviceRecordId);

    const passwordHash = await hashPassword(NEW_PASSWORD);
    await installDeviceAuditFailTrigger();
    try {
      await assert.rejects(
        () =>
          completeInitialStaffActivation({
            userId: staff.id,
            sessionId,
            deviceIdHash: hash,
            passwordHash,
            now: new Date().toISOString(),
          }),
        (error: unknown) =>
          !(error instanceof InitialActivationConflictError) &&
          error instanceof Error,
      );
    } finally {
      await dropAuditFailTriggers();
    }

    const after = await loadUser(staff.id);
    assert.equal(after.passwordHash, before.passwordHash);
    assert.equal(after.mustChangePassword, 1);
    assert.equal(after.initialDeviceAutoApprovalEligible, 1);

    const device = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.id, deviceRecordId))
      .limit(1);
    assert.equal(device[0]?.status, "pending");
    assert.equal(device[0]?.approvedAt, null);

    const sessionCheck = await validateSessionToken(token, { touch: false });
    assert.equal(sessionCheck.ok, true);

    assert.equal(
      (await countAudits(staff.id, "auth.password_changed")).length,
      0,
    );
    assert.equal(
      (
        await countAudits(
          staff.id,
          DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION,
        )
      ).length,
      0,
    );
  });

  it("password audit insert failure rolls back password, device, session, eligibility", async () => {
    const staff = await createEligibleStaff("pwd-audit-fail");
    const before = await loadUser(staff.id);
    const { token, sessionId, hash, deviceRecordId } =
      await openRestrictedSession(staff, `${DEVICE_A}-paf`);
    assert.ok(deviceRecordId);

    const passwordHash = await hashPassword(NEW_PASSWORD);
    await installPasswordAuditFailTrigger();
    try {
      await assert.rejects(
        () =>
          completeInitialStaffActivation({
            userId: staff.id,
            sessionId,
            deviceIdHash: hash,
            passwordHash,
            now: new Date().toISOString(),
          }),
        (error: unknown) =>
          !(error instanceof InitialActivationConflictError) &&
          error instanceof Error,
      );
    } finally {
      await dropAuditFailTriggers();
    }

    const after = await loadUser(staff.id);
    assert.equal(after.passwordHash, before.passwordHash);
    assert.equal(after.mustChangePassword, 1);
    assert.equal(after.initialDeviceAutoApprovalEligible, 1);

    const device = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.id, deviceRecordId))
      .limit(1);
    assert.equal(device[0]?.status, "pending");
    assert.equal(device[0]?.approvedAt, null);

    const sessionCheck = await validateSessionToken(token, { touch: false });
    assert.equal(sessionCheck.ok, true);

    assert.equal(
      (await countAudits(staff.id, "auth.password_changed")).length,
      0,
    );
    assert.equal(
      (
        await countAudits(
          staff.id,
          DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION,
        )
      ).length,
      0,
    );
  });

  it("conflict when device rejected: password and eligibility unchanged", async () => {
    const staff = await createEligibleStaff("reject");
    const { sessionId, hash, deviceRecordId } = await openRestrictedSession(
      staff,
      `${DEVICE_A}-rej`,
    );
    assert.ok(deviceRecordId);

    await rejectAuthorizedDevice(adminUser, deviceRecordId, {
      ipAddress: "127.0.0.1",
      userAgent: "admin",
    });

    const before = await loadUser(staff.id);
    const passwordHash = await hashPassword(NEW_PASSWORD);

    await assert.rejects(
      () =>
        completeInitialStaffActivation({
          userId: staff.id,
          sessionId,
          deviceIdHash: hash,
          passwordHash,
          now: new Date().toISOString(),
        }),
      (error: unknown) => error instanceof InitialActivationConflictError,
    );

    const after = await loadUser(staff.id);
    assert.equal(after.passwordHash, before.passwordHash);
    assert.equal(after.mustChangePassword, 1);
    assert.equal(after.initialDeviceAutoApprovalEligible, 0);
  });

  it("two devices concurrent: only one approved and one password change", async () => {
    const staff = await createEligibleStaff("race");
    const hashA = await hashDeviceId(`${DEVICE_A}-race`);
    const hashB = await hashDeviceId(`${DEVICE_B}-race`);

    assert.equal(
      (
        await evaluateStaffDeviceLogin(staff, hashA, {
          ipAddress: "10.2.1.1",
          userAgent: "A",
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await evaluateStaffDeviceLogin(await loadUser(staff.id), hashB, {
          ipAddress: "10.2.1.2",
          userAgent: "B",
        })
      ).ok,
      true,
    );

    const req = new Request("https://crm.example/login", {
      headers: { "user-agent": "race" },
    });
    const sessionA = await createSession(staff.id, req, hashA);
    const sessionB = await createSession(staff.id, req, hashB);

    const passwordHashA = await hashPassword("RacePassA1");
    const passwordHashB = await hashPassword("RacePassB1");
    const now = new Date().toISOString();

    const outcomes = await Promise.allSettled([
      completeInitialStaffActivation({
        userId: staff.id,
        sessionId: sessionA.sessionId,
        deviceIdHash: hashA,
        passwordHash: passwordHashA,
        now,
      }),
      completeInitialStaffActivation({
        userId: staff.id,
        sessionId: sessionB.sessionId,
        deviceIdHash: hashB,
        passwordHash: passwordHashB,
        now,
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const after = await loadUser(staff.id);
    assert.equal(after.mustChangePassword, 0);
    assert.equal(after.initialDeviceAutoApprovalEligible, 0);
    assert.equal(await countApprovedDevicesForUser(staff.id), 1);

    assert.equal(
      (await countAudits(staff.id, "auth.password_changed")).length,
      1,
    );
    assert.equal(
      (
        await countAudits(
          staff.id,
          DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION,
        )
      ).length,
      1,
    );

    const matchesA = await verifyPassword("RacePassA1", after.passwordHash);
    const matchesB = await verifyPassword("RacePassB1", after.passwordHash);
    assert.equal(matchesA || matchesB, true);
    assert.equal(matchesA && matchesB, false);

    const devices = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.userId, staff.id));
    const approved = devices.filter((row) => row.status === "approved");
    const pending = devices.filter((row) => row.status === "pending");
    assert.equal(approved.length, 1);
    assert.equal(pending.length, 1);
  });

  it("duplicate submit on same session: second call conflicts", async () => {
    const staff = await createEligibleStaff("dup");
    const { sessionId, hash } = await openRestrictedSession(
      staff,
      `${DEVICE_A}-dup`,
    );
    const passwordHash = await hashPassword(NEW_PASSWORD);
    const now = new Date().toISOString();

    await completeInitialStaffActivation({
      userId: staff.id,
      sessionId,
      deviceIdHash: hash,
      passwordHash,
      now,
    });

    const otherHash = await hashPassword("OtherPass1");
    await assert.rejects(
      () =>
        completeInitialStaffActivation({
          userId: staff.id,
          sessionId,
          deviceIdHash: hash,
          passwordHash: otherHash,
          now: new Date().toISOString(),
        }),
      (error: unknown) => error instanceof InitialActivationConflictError,
    );

    const after = await loadUser(staff.id);
    assert.equal(await verifyPassword(NEW_PASSWORD, after.passwordHash), true);
    assert.equal(await countApprovedDevicesForUser(staff.id), 1);
    assert.equal(
      (await countAudits(staff.id, "auth.password_changed")).length,
      1,
    );
    assert.equal(
      (
        await countAudits(
          staff.id,
          DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION,
        )
      ).length,
      1,
    );
  });

  it("same now and same password hash concurrent duplicate: one success, no duplicate audits", async () => {
    const staff = await createEligibleStaff("same-now");
    const { sessionId, hash } = await openRestrictedSession(
      staff,
      `${DEVICE_A}-sn`,
    );
    const passwordHash = await hashPassword(NEW_PASSWORD);
    const now = "2026-07-20T12:00:00.000Z";

    const outcomes = await Promise.allSettled([
      completeInitialStaffActivation({
        userId: staff.id,
        sessionId,
        deviceIdHash: hash,
        passwordHash,
        now,
      }),
      completeInitialStaffActivation({
        userId: staff.id,
        sessionId,
        deviceIdHash: hash,
        passwordHash,
        now,
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0]?.status === "rejected" &&
        rejected[0].reason instanceof InitialActivationConflictError,
    );

    assert.equal(
      (await countAudits(staff.id, "auth.password_changed", now)).length,
      1,
    );
    assert.equal(
      (
        await countAudits(
          staff.id,
          DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION,
          now,
        )
      ).length,
      1,
    );
    assert.equal(await countApprovedDevicesForUser(staff.id), 1);
  });

  it("admin already approved current device: activation conflicts; eligibility already 0", async () => {
    const staff = await createEligibleStaff("admin-appr");
    const { sessionId, hash, deviceRecordId } = await openRestrictedSession(
      staff,
      `${DEVICE_A}-appr`,
    );
    assert.ok(deviceRecordId);
    await approveAuthorizedDevice(adminUser, deviceRecordId, {
      ipAddress: "127.0.0.1",
      userAgent: "admin",
    });
    assert.equal((await loadUser(staff.id)).initialDeviceAutoApprovalEligible, 0);

    const passwordHash = await hashPassword(NEW_PASSWORD);
    await assert.rejects(
      () =>
        completeInitialStaffActivation({
          userId: staff.id,
          sessionId,
          deviceIdHash: hash,
          passwordHash,
          now: new Date().toISOString(),
        }),
      (error: unknown) => error instanceof InitialActivationConflictError,
    );

    const activationAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        eq(
          schema.auditLogs.action,
          DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION,
        ),
      );
    assert.equal(
      activationAudits.filter((row) => row.entityId === deviceRecordId).length,
      0,
    );
  });

  it("other pending device remains pending when one is auto-approved", async () => {
    const staff = await createEligibleStaff("other-pending");
    const hashA = await hashDeviceId(`${DEVICE_A}-op`);
    const hashB = await hashDeviceId(`${DEVICE_B}-op`);

    assert.equal(
      (
        await evaluateStaffDeviceLogin(staff, hashA, {
          ipAddress: "10.2.3.1",
          userAgent: "A",
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await evaluateStaffDeviceLogin(await loadUser(staff.id), hashB, {
          ipAddress: "10.2.3.2",
          userAgent: "B",
        })
      ).ok,
      true,
    );

    const req = new Request("https://crm.example/login", {
      headers: { "user-agent": "op" },
    });
    const session = await createSession(staff.id, req, hashA);
    await completeInitialStaffActivation({
      userId: staff.id,
      sessionId: session.sessionId,
      deviceIdHash: hashA,
      passwordHash: await hashPassword(NEW_PASSWORD),
      now: new Date().toISOString(),
    });

    const devices = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.userId, staff.id));
    const statuses = Object.fromEntries(
      devices.map((row) => [row.deviceIdHash, row.status]),
    );
    assert.equal(statuses[hashA], "approved");
    assert.equal(statuses[hashB], "pending");
    assert.equal(await countApprovedDevicesForUser(staff.id), 1);
  });

  it("device authorization off: consume eligibility without approving device", async () => {
    await setDeviceAuthEnabled(false);
    const staff = await createEligibleStaff("auth-off");
    const hash = await hashDeviceId(`${DEVICE_A}-off`);
    await db.insert(schema.authorizedDevices).values({
      id: crypto.randomUUID(),
      userId: staff.id,
      deviceIdHash: hash,
      deviceName: "Pending Off",
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const req = new Request("https://crm.example/login", {
      headers: { "user-agent": "off" },
    });
    const { sessionId, token } = await createSession(staff.id, req, hash);
    const now = new Date().toISOString();
    await completeForcedPasswordChangeConsumingEligibility({
      userId: staff.id,
      sessionId,
      passwordHash: await hashPassword(NEW_PASSWORD),
      now,
      deviceAuthorizationEnabled: false,
    });

    const after = await loadUser(staff.id);
    assert.equal(after.mustChangePassword, 0);
    assert.equal(after.initialDeviceAutoApprovalEligible, 0);
    assert.equal(after.passwordChangedAt, now);
    assert.equal(await verifyPassword(NEW_PASSWORD, after.passwordHash), true);

    const device = await db
      .select()
      .from(schema.authorizedDevices)
      .where(eq(schema.authorizedDevices.userId, staff.id))
      .limit(1);
    assert.equal(device[0]?.status, "pending");

    const sessionRows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    assert.equal(sessionRows[0]?.revokedAt, now);
    assert.equal((await validateSessionToken(token, { touch: false })).ok, false);

    const passwordAudits = await countAudits(
      staff.id,
      "auth.password_changed",
      now,
    );
    assert.equal(passwordAudits.length, 1);
    assert.ok(
      passwordAudits[0]?.metadata?.includes('"initialEligibilityConsumed":true'),
    );
    assert.ok(
      passwordAudits[0]?.metadata?.includes('"deviceAuthorizationEnabled":false'),
    );
    assert.ok(
      passwordAudits[0]?.metadata?.includes('"initialActivation":false'),
    );

    assert.equal(
      (
        await countAudits(
          staff.id,
          DEVICE_AUDIT_ACTIONS.APPROVED_INITIAL_ACTIVATION,
        )
      ).length,
      0,
    );

    await setDeviceAuthEnabled(true);
  });

  it("device auth off: same session concurrent duplicate with same now/hash", async () => {
    await setDeviceAuthEnabled(false);
    const staff = await createEligibleStaff("auth-off-dup");
    const hash = await hashDeviceId(`${DEVICE_A}-off-dup`);
    const req = new Request("https://crm.example/login", {
      headers: { "user-agent": "off-dup" },
    });
    const { sessionId } = await createSession(staff.id, req, hash);
    const passwordHash = await hashPassword(NEW_PASSWORD);
    const now = "2026-07-20T13:00:00.000Z";

    const outcomes = await Promise.allSettled([
      completeForcedPasswordChangeConsumingEligibility({
        userId: staff.id,
        sessionId,
        passwordHash,
        now,
        deviceAuthorizationEnabled: false,
      }),
      completeForcedPasswordChangeConsumingEligibility({
        userId: staff.id,
        sessionId,
        passwordHash,
        now,
        deviceAuthorizationEnabled: false,
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0]?.status === "rejected" &&
        rejected[0].reason instanceof InitialActivationConflictError,
    );

    const after = await loadUser(staff.id);
    assert.equal(after.mustChangePassword, 0);
    assert.equal(after.initialDeviceAutoApprovalEligible, 0);
    assert.equal(after.passwordHash, passwordHash);
    assert.equal(
      (await countAudits(staff.id, "auth.password_changed", now)).length,
      1,
    );

    await setDeviceAuthEnabled(true);
  });

  it("device auth off: password audit failure rolls back user and session", async () => {
    await setDeviceAuthEnabled(false);
    const staff = await createEligibleStaff("auth-off-audit-fail");
    const before = await loadUser(staff.id);
    const hash = await hashDeviceId(`${DEVICE_A}-off-af`);
    const req = new Request("https://crm.example/login", {
      headers: { "user-agent": "off-af" },
    });
    const { sessionId, token } = await createSession(staff.id, req, hash);
    const passwordHash = await hashPassword(NEW_PASSWORD);

    await installPasswordAuditFailTrigger();
    try {
      await assert.rejects(
        () =>
          completeForcedPasswordChangeConsumingEligibility({
            userId: staff.id,
            sessionId,
            passwordHash,
            now: new Date().toISOString(),
            deviceAuthorizationEnabled: false,
          }),
        (error: unknown) =>
          !(error instanceof InitialActivationConflictError) &&
          error instanceof Error,
      );
    } finally {
      await dropAuditFailTriggers();
    }

    const after = await loadUser(staff.id);
    assert.equal(after.passwordHash, before.passwordHash);
    assert.equal(after.mustChangePassword, 1);
    assert.equal(after.initialDeviceAutoApprovalEligible, 1);
    assert.equal((await validateSessionToken(token, { touch: false })).ok, true);
    assert.equal(
      (await countAudits(staff.id, "auth.password_changed")).length,
      0,
    );

    await setDeviceAuthEnabled(true);
  });
});
