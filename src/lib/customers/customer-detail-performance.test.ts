import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, getDb } from "@/lib/db";
import { getCustomerById } from "@/lib/customers/queries";
import { canConfirmPendingCustomerName } from "@/lib/customers/confirm-name";
import {
  assertCanViewFollowUps,
  isStaffUnclaimedPublicPoolCustomer,
  resolveCustomerAccessOptions,
} from "@/lib/permissions/customers";
import { enrichCustomerResponse } from "@/lib/customers/scoring/service";
import {
  resolveCustomerAssigneeNames,
  resolveCustomerUserLabels,
} from "@/lib/customers/user-labels";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { getCustomerTimeline } from "@/lib/customers/timeline/service";
import type { User } from "../../../drizzle/schema/users";

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

function readDetailPageSource(): string {
  return readFileSync("src/app/(dashboard)/customers/[id]/page.tsx", "utf8");
}

function extractPostAccessSection(source: string): string {
  const start = source.indexOf("const view = scoresView;");
  const end = source.indexOf("<CustomerDetailClient");
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

describe("customer detail Phase 2B1 orchestration", () => {
  it("enrichCustomerResponse occurs before secondary parallel loaders", () => {
    const source = readDetailPageSource();
    const enrichIndex = source.indexOf("enrichCustomerResponse");
    const parallelIndex = source.indexOf("await Promise.all([");
    assert.ok(enrichIndex >= 0);
    assert.ok(parallelIndex > enrichIndex);
  });

  it("secondary loaders run in one post-access Promise.all stage", () => {
    const section = extractPostAccessSection(readDetailPageSource());
    const parallelBlock = section.slice(section.indexOf("await Promise.all(["));
    assert.match(parallelBlock, /canConfirmPendingCustomerName/);
    assert.match(parallelBlock, /followUpsPromise/);
    assert.match(parallelBlock, /getCustomerTimeline/);
    assert.match(parallelBlock, /resolveCustomerUserLabels/);
    assert.match(parallelBlock, /resolveCustomerAssigneeNames/);
    const parallelCount = (section.match(/await Promise\.all\(\[/g) ?? []).length;
    assert.equal(parallelCount, 1);
  });

  it("follow-up list is gated by assertCanViewFollowUps before promise creation", () => {
    const section = extractPostAccessSection(readDetailPageSource());
    const followUpGateIndex = section.indexOf("assertCanViewFollowUps");
    const followUpPromiseIndex = section.indexOf("followUpsPromise = listFollowUpsByCustomerId");
    assert.ok(followUpGateIndex >= 0);
    assert.ok(followUpPromiseIndex > followUpGateIndex);
    assert.match(section, /catch \{\s*\/\/ masked or denied/);
  });

  it("does not parallelize before pending on-hold or public-pool gates", () => {
    const source = readDetailPageSource();
    const parallelIndex = source.indexOf("await Promise.all([");
    const onHoldIndex = source.indexOf("getPendingOnHoldCreateApprovalForCustomer");
    const poolGateIndex = source.indexOf("isStaffUnclaimedPublicPoolCustomer");
    assert.ok(parallelIndex > onHoldIndex);
    assert.ok(parallelIndex > poolGateIndex);
  });
});

describe("customer detail Phase 2B1 permissions and data", () => {
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    const db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  async function loadAuthorizedDetailData(user: User, customerId: string) {
    const db = getDb();
    const customer = await getCustomerById(customerId);
    assert.ok(customer);
    assert.equal(isStaffUnclaimedPublicPoolCustomer(user, customer), false);

    const accessOptions = await resolveCustomerAccessOptions(db, user, customerId);
    const scoresView = await enrichCustomerResponse(
      db,
      user,
      customer,
      new Date(),
      accessOptions,
    );

    let followUpsPromise: ReturnType<typeof listFollowUpsByCustomerId> =
      Promise.resolve([]);
    try {
      assertCanViewFollowUps(user, customer, accessOptions);
      followUpsPromise = listFollowUpsByCustomerId(customerId);
    } catch {
      // masked or denied
    }

    const [
      showConfirmNameButton,
      followUps,
      timeline,
      userLabels,
      assigneeNames,
    ] = await Promise.all([
      canConfirmPendingCustomerName(db, user, customer),
      followUpsPromise,
      getCustomerTimeline(db, user, customer, accessOptions),
      resolveCustomerUserLabels(db, customer),
      resolveCustomerAssigneeNames(db, customerId),
    ]);

    return {
      scoresView,
      showConfirmNameButton,
      followUps,
      timeline,
      userLabels,
      assigneeNames,
    };
  }

  it("admin can load parallelized detail data for owned customer", async () => {
    const data = await loadAuthorizedDetailData(
      adminUser,
      SEED_IDS.customerStaffA,
    );
    assert.equal(data.scoresView.accessLevel, "full");
    assert.ok(Array.isArray(data.followUps));
    assert.ok(Array.isArray(data.timeline.items));
    assert.ok(data.userLabels.ownerName);
    assert.ok(Array.isArray(data.assigneeNames));
  });

  it("owner staff can load parallelized detail data", async () => {
    const data = await loadAuthorizedDetailData(
      staffA,
      SEED_IDS.customerStaffA,
    );
    assert.equal(data.scoresView.accessLevel, "full");
    assert.equal("customerCode" in data.scoresView, false);
  });

  it("assigned staff can load parallelized detail data", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const testRowId = "d2c-test-collaborator-0001-0001-0001-000000000003";
    const { eq } = await import("drizzle-orm");
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, testRowId));
    await db.insert(schema.customerAssignees).values({
      id: testRowId,
      customerId: SEED_IDS.customerStaffA,
      userId: SEED_IDS.staffB,
      role: "collaborator",
      assignedBy: SEED_IDS.admin,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const data = await loadAuthorizedDetailData(
        staffB,
        SEED_IDS.customerStaffA,
      );
      assert.equal(data.scoresView.accessLevel, "full");
    } finally {
      await db
        .delete(schema.customerAssignees)
        .where(eq(schema.customerAssignees.id, testRowId));
    }
  });

  it("unrelated staff cannot enrich unauthorized customer", async () => {
    const db = getDb();
    const customer = await getCustomerById(SEED_IDS.customerStaffA);
    assert.ok(customer);
    const unrelatedStaff = {
      id: "11111111-1111-1111-1111-111111111199",
      role: "staff",
    } as User;

    await assert.rejects(async () => {
      const accessOptions = await resolveCustomerAccessOptions(
        db,
        unrelatedStaff,
        SEED_IDS.customerStaffA,
      );
      await enrichCustomerResponse(
        db,
        unrelatedStaff,
        customer,
        new Date(),
        accessOptions,
      );
    });
  });

  it("unclaimed public-pool customer remains denied before secondary loaders", async () => {
    const customer = await getCustomerById(SEED_IDS.customerPublicPool);
    assert.ok(customer);
    assert.equal(isStaffUnclaimedPublicPoolCustomer(staffA, customer), true);
  });
});
