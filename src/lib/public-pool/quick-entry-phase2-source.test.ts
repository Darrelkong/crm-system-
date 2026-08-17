import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY } from "@/lib/constants/customer-sources";
import {
  createCustomerDirectlyInPublicPool,
} from "@/lib/public-pool/quick-entry-customer-service";
import { QUICK_ENTRY_ENTRY_METHOD } from "@/lib/public-pool/quick-entry-entry-method";
import { processQuickEntryCustomerSubmission } from "@/lib/public-pool/quick-entry-batch-service";
import type { QuickEntryBatchRowResult } from "@/lib/public-pool/quick-entry-batch-types";
import {
  QUICK_ENTRY_CUSTOMER_ERROR_CODES,
  validateQuickEntryCustomerInput,
} from "@/lib/public-pool/quick-entry-customer-validation";
import { getSelectableCustomerSourceKeys } from "@/lib/customer-sources/keys";

const QE2P_STAFF_ID = "qe2p2222-2222-2222-2222-222222222201";
const QE2P_STAFF_EMAIL = "qe2p-staff@crm.test.local";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let staffUser: User;
let selectableSourceKeys: string[] = [];
const createdCustomerIds: string[] = [];

const validRow = {
  customerName: "快录客户",
  nameStatus: "confirmed" as const,
  phone: "13920001001",
  requestedProjectCode: "hk_bank_account",
  requestedProjectName: "加拿大移民项目",
};

async function cleanupTrackedCustomers() {
  if (createdCustomerIds.length === 0) return;
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

async function cleanupStaffFixture() {
  await cleanupTrackedCustomers();
  const staffCustomers = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.createdBy, QE2P_STAFF_ID));
  const staffCustomerIds = staffCustomers.map((row) => row.id);
  if (staffCustomerIds.length > 0) {
    await db
      .delete(schema.auditLogs)
      .where(inArray(schema.auditLogs.entityId, staffCustomerIds));
    await db
      .delete(schema.customerAssignees)
      .where(inArray(schema.customerAssignees.customerId, staffCustomerIds));
    await db
      .delete(schema.tasks)
      .where(inArray(schema.tasks.customerId, staffCustomerIds));
    await db
      .delete(schema.followUps)
      .where(inArray(schema.followUps.customerId, staffCustomerIds));
    await db
      .delete(schema.fieldChangeLogs)
      .where(inArray(schema.fieldChangeLogs.customerId, staffCustomerIds));
    await db
      .delete(schema.customers)
      .where(inArray(schema.customers.id, staffCustomerIds));
  }
  await db
    .delete(schema.publicPoolQuickEntrySubmissions)
    .where(eq(schema.publicPoolQuickEntrySubmissions.actorUserId, QE2P_STAFF_ID));
  await db.delete(schema.users).where(eq(schema.users.id, QE2P_STAFF_ID));
}

function trackId(id: string) {
  createdCustomerIds.push(id);
}

describe("Quick Entry Phase 2 — source separation", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    await cleanupStaffFixture();

    const now = new Date().toISOString();
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, QE2P_STAFF_ID))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(schema.users).values({
        id: QE2P_STAFF_ID,
        email: QE2P_STAFF_EMAIL,
        displayName: "QE2P Staff",
        role: "staff",
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
        .where(eq(schema.users.id, QE2P_STAFF_ID));
    }
    staffUser = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, QE2P_STAFF_ID))
        .limit(1)
    )[0] as User;
    selectableSourceKeys = await getSelectableCustomerSourceKeys(db);
    assert.ok(selectableSourceKeys.includes("xiaohongshu"));
    assert.ok(selectableSourceKeys.includes("google"));
    assert.ok(selectableSourceKeys.includes("xianyu_taobao"));
    assert.ok(selectableSourceKeys.includes("source_unknown"));
  });

  after(async () => {
    await cleanupStaffFixture();
    bindTestDatabase(null);
    if (disposeProxy) await disposeProxy();
  });

  for (const [label, source] of [
    ["小红书", "xiaohongshu"],
    ["微信视频号", "wechat_video_channel"],
    ["Google", "google"],
    ["淘宝", "xianyu_taobao"],
    ["来源不明", "source_unknown"],
  ] as const) {
    it(`single Quick Entry saves source=${source} (${label})`, async () => {
      const phone = `1392${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
      const result = await createCustomerDirectlyInPublicPool({
        actor: staffUser,
        customer: { ...validRow, phone, source },
        db,
      });
      assert.equal(
        result.ok,
        true,
        !result.ok
          ? `${label}: ${result.errorCode} ${result.message}`
          : label,
      );
      if (!result.ok) return;
      trackId(result.customerId);

      const row = (
        await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, result.customerId))
          .limit(1)
      )[0];
      assert.ok(row);
      assert.equal(row.source, source);
      assert.equal(row.entryMethod, QUICK_ENTRY_ENTRY_METHOD);
      assert.equal(row.status, "public_pool");
    });
  }

  it("rejects invalid Quick Entry sources", async () => {
    const invalidSources = [
      PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY,
      "online_media",
      "wechat",
      "missing_primary_backfill",
      "random_invalid_source",
      "",
    ];
    for (const source of invalidSources) {
      const result = validateQuickEntryCustomerInput(
        { ...validRow, source: source || undefined },
        { selectableSourceKeys },
      );
      assert.equal(result.ok, false, source || "(missing)");
    }
  });

  it("mixed-source batch creates customers with per-row source", async () => {
    const submissionId = "550e8400-e29b-41d4-a716-4466554400a2";
    const rows = [
      {
        clientRowId: "p2-a",
        ...validRow,
        customerName: "批次甲",
        phone: "13920002001",
        source: "xiaohongshu",
      },
      {
        clientRowId: "p2-b",
        ...validRow,
        customerName: "批次乙",
        phone: "13920002002",
        source: "google",
      },
      {
        clientRowId: "p2-c",
        ...validRow,
        customerName: "批次丙",
        phone: "13920002003",
        source: "xianyu_taobao",
      },
    ];
    const result = await processQuickEntryCustomerSubmission({
      actor: staffUser,
      submissionId,
      rows,
      db,
      now: new Date("2026-08-17T12:00:00.000Z"),
    });
    assert.equal(result.ok, true, !result.ok ? result.message : undefined);
    if (!result.ok) return;
    const batch = result;

    const expectedSources = ["xiaohongshu", "google", "xianyu_taobao"] as const;
    for (let i = 0; i < expectedSources.length; i += 1) {
      const rowInput = rows[i]!;
      const match: QuickEntryBatchRowResult | undefined = batch.results.find(
        (r) => r.clientRowId === rowInput.clientRowId,
      );
      assert.equal(match?.status, "created");
      if (match?.status !== "created") continue;
      trackId(match.customerId);
      const customerRows = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, match.customerId))
        .limit(1);
      const customerRow = customerRows[0];
      assert.ok(customerRow);
      assert.equal(customerRow.source, expectedSources[i]);
      assert.equal(customerRow.entryMethod, QUICK_ENTRY_ENTRY_METHOD);
      assert.equal(customerRow.status, "public_pool");
    }
  });

  it("batch partial invalid keeps row-level semantics for bad source", async () => {
    const submissionId = "550e8400-e29b-41d4-a716-4466554400a3";
    const result = await processQuickEntryCustomerSubmission({
      actor: staffUser,
      submissionId,
      rows: [
        {
          clientRowId: "p3-good",
          ...validRow,
          customerName: "有效行",
          phone: "13920003001",
          source: "xiaohongshu",
        },
        {
          clientRowId: "p3-bad",
          ...validRow,
          customerName: "无效行",
          phone: "13920003002",
          source: PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY,
        },
      ],
      db,
      now: new Date("2026-08-17T12:05:00.000Z"),
    });
    assert.equal(result.ok, true, !result.ok ? result.message : undefined);
    if (!result.ok) return;
    assert.equal(result.summary.created, 1);
    assert.equal(result.summary.invalid, 1);

    const good = result.results.find((r) => r.clientRowId === "p3-good");
    const bad = result.results.find((r) => r.clientRowId === "p3-bad");
    assert.equal(good?.status, "created");
    assert.equal(bad?.status, "invalid");
    if (good?.status === "created") trackId(good.customerId);

    const invalidCustomers = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.phone, "13920003002"),
          eq(schema.customers.entryMethod, QUICK_ENTRY_ENTRY_METHOD),
        ),
      );
    assert.equal(invalidCustomers.length, 0);
  });

  it("requires source in validation", () => {
    const missing = validateQuickEntryCustomerInput(validRow, {
      selectableSourceKeys,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(
        missing.errors.some(
          (e) => e.errorCode === QUICK_ENTRY_CUSTOMER_ERROR_CODES.SOURCE_REQUIRED,
        ),
        true,
      );
    }
  });
});
