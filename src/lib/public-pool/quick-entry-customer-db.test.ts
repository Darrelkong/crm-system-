import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY } from "@/lib/constants/customer-sources";
import {
  createCustomerDirectlyInPublicPool,
  QUICK_ENTRY_CUSTOMER_AUDIT_ACTION,
  QUICK_ENTRY_SERVICE_ERROR_CODES,
} from "@/lib/public-pool/quick-entry-customer-service";
import { listRandomClaimCandidatesForStaff } from "@/lib/public-pool/queries";
import { getActiveCustomerTagKeys } from "@/lib/customer-tags/queries";
import { formatCustomerCode } from "@/lib/customers/customer-code";

const QE2_ADMIN_ID = "qe222222-2222-2222-2222-222222222201";
const QE2_STAFF_ID = "qe222222-2222-2222-2222-222222222202";
const QE2_ADMIN_EMAIL = "qe2-admin@crm.test.local";
const QE2_STAFF_EMAIL = "qe2-staff@crm.test.local";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;
const createdCustomerIds: string[] = [];

async function cleanup() {
  if (createdCustomerIds.length > 0) {
    await db
      .delete(schema.auditLogs)
      .where(inArray(schema.auditLogs.entityId, createdCustomerIds));
    await db
      .delete(schema.customerAssignees)
      .where(inArray(schema.customerAssignees.customerId, createdCustomerIds));
    await db
      .delete(schema.tasks)
      .where(inArray(schema.tasks.customerId, createdCustomerIds));
    await db
      .delete(schema.followUps)
      .where(inArray(schema.followUps.customerId, createdCustomerIds));
    await db
      .delete(schema.customers)
      .where(inArray(schema.customers.id, createdCustomerIds));
    createdCustomerIds.length = 0;
  }

  await db
    .delete(schema.auditLogs)
    .where(eq(schema.auditLogs.action, QUICK_ENTRY_CUSTOMER_AUDIT_ACTION));

  await db.delete(schema.users).where(eq(schema.users.id, QE2_ADMIN_ID));
  await db.delete(schema.users).where(eq(schema.users.id, QE2_STAFF_ID));
}

async function ensureUsers() {
  const now = new Date().toISOString();
  for (const user of [
    {
      id: QE2_ADMIN_ID,
      email: QE2_ADMIN_EMAIL,
      displayName: "QE2 Admin",
      role: "admin" as const,
    },
    {
      id: QE2_STAFF_ID,
      email: QE2_STAFF_EMAIL,
      displayName: "QE2 Staff",
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
          mustChangePassword: 0,
          updatedAt: now,
        })
        .where(eq(schema.users.id, user.id));
    }
  }

  adminUser = (
    await db.select().from(schema.users).where(eq(schema.users.id, QE2_ADMIN_ID)).limit(1)
  )[0] as User;
  staffUser = (
    await db.select().from(schema.users).where(eq(schema.users.id, QE2_STAFF_ID)).limit(1)
  )[0] as User;
}

function trackId(id: string) {
  createdCustomerIds.push(id);
}

describe("createCustomerDirectlyInPublicPool — DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    await cleanup();
    await ensureUsers();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    if (disposeProxy) await disposeProxy();
  });

  it("creates public-pool customer with fixed semantics and no side effects", async () => {
    const result = await createCustomerDirectlyInPublicPool({
      actor: staffUser,
      customer: {
        customerName: "快录客户甲",
        phone: "13910001001",
        requestedProjectName: "加拿大移民项目",
        initialFollowUpNote: "可选首次备注",
        supplementalNote: "补充备注",
      },
      db,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    trackId(result.customerId);

    assert.match(result.customerCode, /^EF\d{6}$/);
    assert.equal("phone" in result, false);
    assert.equal("notes" in result, false);

    const row = (
      await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, result.customerId))
        .limit(1)
    )[0];
    assert.ok(row);
    assert.equal(row.source, PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY);
    assert.equal(row.salesStage, "contacted");
    assert.equal(row.status, "public_pool");
    assert.equal(row.ownerId, null);
    assert.equal(row.createdBy, QE2_STAFF_ID);
    assert.equal(row.updatedBy, QE2_STAFF_ID);
    assert.ok(row.poolEnteredAt);
    assert.equal(row.claimedBy, null);
    assert.equal(row.releasedBy, null);
    assert.equal(row.releaserUserId, null);
    assert.equal(row.previousOwnerId, null);
    assert.equal(row.poolReason, null);
    assert.equal(row.customerType, "individual");
    assert.equal(row.notes, "可选首次备注");
    assert.equal(row.sourceRemark, "补充备注");
    assert.equal(row.deletedAt, null);

    const assignees = await db
      .select()
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, result.customerId));
    assert.equal(assignees.length, 0);

    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.customerId, result.customerId));
    assert.equal(tasks.length, 0);

    const followUps = await db
      .select()
      .from(schema.followUps)
      .where(eq(schema.followUps.customerId, result.customerId));
    assert.equal(followUps.length, 0);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, result.customerId),
          eq(schema.auditLogs.action, QUICK_ENTRY_CUSTOMER_AUDIT_ACTION),
        ),
      );
    assert.equal(audits.length, 1);
    const meta = audits[0]?.metadata ?? "";
    assert.equal(meta.includes("13910001001"), false);
    assert.equal(meta.includes("可选首次备注"), false);
    assert.equal(meta.includes("补充备注"), false);
    assert.ok(meta.includes('"hasPhone":true'));
    assert.ok(meta.includes('"creationMethod":"quick_entry"'));

    const releaseAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, result.customerId),
          like(schema.auditLogs.action, "%released_to_pool%"),
        ),
      );
    assert.equal(releaseAudits.length, 0);
  });

  it("rejects duplicate phone / wechat without creating customer or success audit", async () => {
    const first = await createCustomerDirectlyInPublicPool({
      actor: adminUser,
      customer: {
        customerName: "重复客户",
        phone: "13910002002",
        wechatId: "qe2_dup_wx",
        requestedProjectName: "澳洲移民项目",
      },
      db,
    });
    assert.equal(first.ok, true);
    if (first.ok) trackId(first.customerId);

    const dupPhone = await createCustomerDirectlyInPublicPool({
      actor: staffUser,
      customer: {
        customerName: "另一客户",
        phone: "13910002002",
        requestedProjectName: "澳洲移民项目",
      },
      db,
    });
    assert.equal(dupPhone.ok, false);
    if (!dupPhone.ok) {
      assert.equal(
        dupPhone.errorCode,
        QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_PHONE,
      );
      assert.equal(dupPhone.duplicate, true);
      assert.equal("customer" in dupPhone, false);
    }

    const dupWx = await createCustomerDirectlyInPublicPool({
      actor: staffUser,
      customer: {
        customerName: "另一客户二",
        wechatId: "qe2_dup_wx",
        requestedProjectName: "澳洲移民项目",
      },
      db,
    });
    assert.equal(dupWx.ok, false);
    if (!dupWx.ok) {
      assert.equal(
        dupWx.errorCode,
        QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_WECHAT,
      );
    }

    const count = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.phone, "13910002002"));
    assert.equal(count.length, 1);
  });

  it("allocates distinct EF codes under concurrency", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        createCustomerDirectlyInPublicPool({
          actor: staffUser,
          customer: {
            customerName: `并发生成${n}`,
            phone: `13910003${String(n).padStart(3, "0")}`,
            requestedProjectName: "新西兰移民项目",
          },
          db,
        }),
      ),
    );

    for (const result of results) {
      assert.equal(result.ok, true);
      if (result.ok) trackId(result.customerId);
    }

    const codes = results
      .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      .map((r) => r.customerCode);
    assert.equal(new Set(codes).size, codes.length);
    for (const code of codes) {
      assert.match(code, /^EF\d{6}$/);
      const n = Number(code.slice(2));
      assert.equal(formatCustomerCode(n), code);
    }
  });

  it("is eligible for random claim candidates and not self-release blocked", async () => {
    const result = await createCustomerDirectlyInPublicPool({
      actor: adminUser,
      customer: {
        customerName: "候选客户",
        phone: "13910004004",
        requestedProjectName: "英国移民项目",
      },
      db,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    trackId(result.customerId);

    // Force earliest poolEnteredAt so it sorts before seed rows in first batch.
    await db
      .update(schema.customers)
      .set({ poolEnteredAt: "1980-01-01T00:00:00.000Z" })
      .where(eq(schema.customers.id, result.customerId));

    const candidates = await listRandomClaimCandidatesForStaff({
      userId: QE2_STAFF_ID,
      now: new Date("2026-07-01T00:00:00.000Z"),
      limit: 10,
      db,
    });
    assert.equal(
      candidates.candidates.some((c) => c.id === result.customerId),
      true,
    );
  });

  it("internal source is not in active create selector keys", async () => {
    const keys = await getActiveCustomerTagKeys(db);
    assert.equal(keys.includes(PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY), false);
  });

  it("rejects inactive actor", async () => {
    await db
      .update(schema.users)
      .set({ isActive: 0 })
      .where(eq(schema.users.id, QE2_STAFF_ID));
    const inactive = (
      await db.select().from(schema.users).where(eq(schema.users.id, QE2_STAFF_ID)).limit(1)
    )[0] as User;

    const result = await createCustomerDirectlyInPublicPool({
      actor: inactive,
      customer: {
        customerName: "无效操作者",
        phone: "13910005005",
        requestedProjectName: "测试项目名称",
      },
      db,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, QUICK_ENTRY_SERVICE_ERROR_CODES.ACTOR_INVALID);
    }

    await db
      .update(schema.users)
      .set({ isActive: 1 })
      .where(eq(schema.users.id, QE2_STAFF_ID));
  });
});
