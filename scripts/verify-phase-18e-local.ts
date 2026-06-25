import { getPlatformProxy } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull, ne } from "drizzle-orm";
import * as schema from "../drizzle/schema/index";
import { bindTestDatabase } from "../src/lib/db/index";
import { SEED_IDS } from "../src/lib/constants/seed-ids";
import {
  setUserStatus,
  softDeleteUserAccount,
  UserAdminError,
} from "../src/lib/users-admin/service";
import type { User } from "../drizzle/schema/users";

type Check = { name: string; ok: boolean; detail?: string };

const ADMIN_ID = SEED_IDS.admin;
const STAFF_B_ID = SEED_IDS.staffB;
const STAFF_B_CUSTOMER_ID = SEED_IDS.customerStaffB;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function getUser(db: ReturnType<typeof drizzle>, id: string) {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function getCustomerOwnerId(
  db: ReturnType<typeof drizzle>,
  customerId: string,
) {
  const rows = await db
    .select({ ownerId: schema.customers.ownerId })
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  return rows[0]?.ownerId ?? null;
}

async function countActiveSessions(db: ReturnType<typeof drizzle>, userId: string) {
  const rows = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)),
    );
  return rows.length;
}

async function countRecords(db: ReturnType<typeof drizzle>, customerId: string) {
  const [followUps, audits, fieldChanges] = await Promise.all([
    db
      .select({ id: schema.followUps.id })
      .from(schema.followUps)
      .where(eq(schema.followUps.customerId, customerId)),
    db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityType, "customer"),
          eq(schema.auditLogs.entityId, customerId),
        ),
      ),
    db
      .select({ id: schema.fieldChangeLogs.id })
      .from(schema.fieldChangeLogs)
      .where(eq(schema.fieldChangeLogs.customerId, customerId)),
  ]);

  return {
    followUps: followUps.length,
    audits: audits.length,
    fieldChanges: fieldChanges.length,
  };
}

async function resetStaffB(db: ReturnType<typeof drizzle>) {
  const now = new Date().toISOString();
  await db
    .update(schema.users)
    .set({
      isActive: 1,
      deletedAt: null,
      updatedAt: now,
    })
    .where(eq(schema.users.id, STAFF_B_ID));

  await db
    .update(schema.customers)
    .set({
      ownerId: STAFF_B_ID,
      updatedBy: ADMIN_ID,
      updatedAt: now,
    })
    .where(eq(schema.customers.id, STAFF_B_CUSTOMER_ID));
}

async function ensureStaffBSession(db: ReturnType<typeof drizzle>) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await db.insert(schema.sessions).values({
    id: crypto.randomUUID(),
    userId: STAFF_B_ID,
    tokenHash: `verify-phase-18e-${Date.now()}`,
    createdAt: now,
    expiresAt,
    lastActivityAt: now,
    revokedAt: null,
  });
}

async function expectError(
  fn: () => Promise<unknown>,
  code: string,
): Promise<Check> {
  try {
    await fn();
    return { name: code, ok: false, detail: "expected error but succeeded" };
  } catch (error) {
    if (error instanceof UserAdminError && error.code === code) {
      return { name: code, ok: true };
    }
    return {
      name: code,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const checks: Check[] = [];
  const { env, dispose } = await getPlatformProxy({
    configPath: new URL("../wrangler.jsonc", import.meta.url).pathname,
  });

  try {
    const db = drizzle(env.DB, { schema });
    bindTestDatabase(db);

    await resetStaffB(db);

    const adminRow = await getUser(db, ADMIN_ID);
    const staffBRow = await getUser(db, STAFF_B_ID);
    assert(adminRow !== null && staffBRow !== null, "seed users missing");

    const admin = adminRow as User;
    const staffB = staffBRow as User;

    const ownerBeforeDisable = await getCustomerOwnerId(db, STAFF_B_CUSTOMER_ID);
    assert(ownerBeforeDisable === STAFF_B_ID, "staff B customer not owned by staff B");

    const recordsBefore = await countRecords(db, STAFF_B_CUSTOMER_ID);

    await ensureStaffBSession(db);
    const sessionsBeforeDisable = await countActiveSessions(db, STAFF_B_ID);
    assert(sessionsBeforeDisable > 0, "expected active session before disable");

    await setUserStatus(admin, STAFF_B_ID, "disabled", {});

    const staffAfterDisable = await getUser(db, STAFF_B_ID);
    checks.push({
      name: "disable: isActive=0",
      ok: staffAfterDisable?.isActive === 0,
    });
    checks.push({
      name: "disable: sessions cleared",
      ok: (await countActiveSessions(db, STAFF_B_ID)) === 0,
    });
    checks.push({
      name: "disable: ownerId unchanged",
      ok:
        (await getCustomerOwnerId(db, STAFF_B_CUSTOMER_ID)) === STAFF_B_ID,
    });
    checks.push({
      name: "disable: not transferred to admin",
      ok:
        (await getCustomerOwnerId(db, STAFF_B_CUSTOMER_ID)) !== ADMIN_ID,
    });

    const recordsAfterDisable = await countRecords(db, STAFF_B_CUSTOMER_ID);
    checks.push({
      name: "disable: follow-ups preserved",
      ok: recordsAfterDisable.followUps === recordsBefore.followUps,
    });
    checks.push({
      name: "disable: audit logs preserved",
      ok: recordsAfterDisable.audits === recordsBefore.audits,
    });

    await setUserStatus(admin, STAFF_B_ID, "active", {});

    const staffAfterEnable = await getUser(db, STAFF_B_ID);
    checks.push({
      name: "enable: isActive=1",
      ok: staffAfterEnable?.isActive === 1,
    });
    checks.push({
      name: "enable: customer still owned by staff B",
      ok:
        (await getCustomerOwnerId(db, STAFF_B_CUSTOMER_ID)) === STAFF_B_ID,
    });

    await ensureStaffBSession(db);
    const deleteResult = await softDeleteUserAccount(admin, STAFF_B_ID, {});

    const staffAfterDelete = await getUser(db, STAFF_B_ID);
    const userRowStillExists = staffAfterDelete !== null;
    checks.push({
      name: "delete: user row preserved (soft delete)",
      ok: userRowStillExists,
    });
    checks.push({
      name: "delete: isActive=0",
      ok: staffAfterDelete?.isActive === 0,
    });
    checks.push({
      name: "delete: deletedAt set",
      ok: !!staffAfterDelete?.deletedAt,
    });
    checks.push({
      name: "delete: sessions cleared",
      ok: (await countActiveSessions(db, STAFF_B_ID)) === 0,
    });
    checks.push({
      name: "delete: customer transferred to acting admin",
      ok:
        (await getCustomerOwnerId(db, STAFF_B_CUSTOMER_ID)) === ADMIN_ID,
    });
    checks.push({
      name: "delete: transferred count >= 1",
      ok: deleteResult.transferredCount >= 1,
    });

    const recordsAfterDelete = await countRecords(db, STAFF_B_CUSTOMER_ID);
    checks.push({
      name: "delete: follow-ups preserved",
      ok: recordsAfterDelete.followUps >= recordsBefore.followUps,
    });
    checks.push({
      name: "delete: audit logs preserved/increased",
      ok: recordsAfterDelete.audits >= recordsBefore.audits,
    });
    checks.push({
      name: "delete: field change logs preserved/increased",
      ok: recordsAfterDelete.fieldChanges >= recordsBefore.fieldChanges,
    });

    const transferAudit = await db
      .select({ action: schema.auditLogs.action, metadata: schema.auditLogs.metadata })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityType, "customer"),
          eq(schema.auditLogs.entityId, STAFF_B_CUSTOMER_ID),
          eq(schema.auditLogs.action, "customer.transferred.staff_deleted"),
        ),
      )
      .limit(1);

    checks.push({
      name: "delete: transfer audit written",
      ok: transferAudit.length === 1,
    });

    if (transferAudit[0]?.metadata) {
      const metadata = JSON.parse(transferAudit[0].metadata) as {
        reason?: string;
        previousOwnerId?: string;
        newOwnerId?: string;
      };
      checks.push({
        name: "delete: transfer audit reason",
        ok: metadata.reason === "staff_deleted_transfer",
      });
      checks.push({
        name: "delete: transfer audit previousOwnerId",
        ok: metadata.previousOwnerId === STAFF_B_ID,
      });
      checks.push({
        name: "delete: transfer audit newOwnerId",
        ok: metadata.newOwnerId === ADMIN_ID,
      });
    }

    checks.push(
      await expectError(
        () => setUserStatus(admin, ADMIN_ID, "disabled", {}),
        "self_disable",
      ),
    );
    checks.push(
      await expectError(
        () => softDeleteUserAccount(admin, ADMIN_ID, {}),
        "self_delete",
      ),
    );
    checks.push(
      await expectError(
        () =>
          setUserStatus(
            { ...staffB, id: "99999999-9999-9999-9999-999999999999", role: "admin" } as User,
            ADMIN_ID,
            "disabled",
            {},
          ),
        "last_admin",
      ),
    );
    checks.push(
      await expectError(
        () =>
          softDeleteUserAccount(
            { ...staffB, id: "99999999-9999-9999-9999-999999999998", role: "admin" } as User,
            ADMIN_ID,
            {},
          ),
        "last_admin",
      ),
    );

    checks.push(
      await expectError(
        () => setUserStatus(admin, STAFF_B_ID, "active", {}),
        "user_deleted",
      ),
    );
    checks.push(
      await expectError(
        () => softDeleteUserAccount(admin, STAFF_B_ID, {}),
        "already_deleted",
      ),
    );

    const failed = checks.filter((check) => !check.ok);
    console.log(JSON.stringify({ checks, failedCount: failed.length }, null, 2));

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    bindTestDatabase(null);
    await dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
