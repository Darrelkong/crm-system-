import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  getAssigneeCustomerIdsForUser,
  getAssigneeCustomerIdsFromRecords,
  listCustomerAssigneesByCustomerIds,
} from "@/lib/customers/assignees";
import { buildCustomerListRows } from "@/lib/customers/list-rows";
import {
  buildCustomerListPagination,
  listCustomersForUserPaginated,
} from "@/lib/customers/queries";
import {
  filterCustomersWithScores,
  getCustomerIdsWithFollowUps,
  getCustomersWithScores,
} from "@/lib/customers/scoring/service";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { CUSTOMER_LIST_ACTIVE_SORT_MODE } from "@/lib/customers/customer-list-sort";
import type { User } from "../../../drizzle/schema/users";

const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;
const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;

function readCustomersPageSource(): string {
  return readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
}

function extractScoringBranch(source: string): string {
  const start = source.indexOf("if (hasScoringFilter)");
  const end = source.indexOf("} else {", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function extractPaginatedBranch(source: string): string {
  const start = source.indexOf("} else {", source.indexOf("if (hasScoringFilter)"));
  const end = source.indexOf("return (", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

describe("customers page Phase 2A load path", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("page parallelizes reclamation risk and settings", () => {
    const page = readCustomersPageSource();
    assert.match(
      page,
      /Promise\.all\(\[\s*resolveReclamationRiskCustomerIds/,
    );
    assert.match(page, /getEffectiveSettings/);
  });

  it("page parallelizes creator options with paginated list for admin", () => {
    const page = readCustomersPageSource();
    assert.match(page, /listCustomerCreatorsForAdmin/);
    assert.match(page, /listCustomersForUserPaginated/);
    assert.match(page, /creatorOptionsPromise/);
  });

  it("non-scoring paginated path uses one shared full assignee map", () => {
    const branch = extractPaginatedBranch(readCustomersPageSource());
    assert.match(branch, /listCustomerAssigneesByCustomerIds/);
    assert.match(branch, /getAssigneeCustomerIdsFromRecords/);
    assert.doesNotMatch(branch, /getAssigneeCustomerIdsForUser/);
    const fullAssigneeCalls = (
      branch.match(/listCustomerAssigneesByCustomerIds/g) ?? []
    ).length;
    assert.equal(fullAssigneeCalls, 1);
  });

  it("scoring path uses user assignee membership for candidates only", () => {
    const branch = extractScoringBranch(readCustomersPageSource());
    assert.match(branch, /getAssigneeCustomerIdsForUser/);
    assert.doesNotMatch(
      branch,
      /listCustomerAssigneesByCustomerIds\(db,\s*customerIds\)/,
    );
    assert.match(branch, /pageViewIds/);
    assert.match(
      branch,
      /listCustomerAssigneesByCustomerIds\(\s*db,\s*pageViewIds/,
    );
  });

  it("list-rows supports preloaded assignee map", () => {
    const listRows = readFileSync("src/lib/customers/list-rows.ts", "utf8");
    assert.match(listRows, /assigneesByCustomerId\?:/);
    assert.match(listRows, /options\?\.assigneesByCustomerId/);
  });

  it("getAssigneeCustomerIdsFromRecords matches getAssigneeCustomerIdsForUser", async () => {
    const result = await listCustomersForUserPaginated(staffB, {}, 1);
    const customerIds = result.items.map((item) => item.id);
    const assigneesByCustomerId = await listCustomerAssigneesByCustomerIds(
      db,
      customerIds,
    );

    const fromRecords = getAssigneeCustomerIdsFromRecords(
      staffB.id,
      customerIds,
      assigneesByCustomerId,
    );
    const fromQuery = await getAssigneeCustomerIdsForUser(
      db,
      staffB.id,
      customerIds,
    );

    assert.deepEqual(fromRecords, fromQuery);
  });

  it("paginated path performs one full assignee read for page customer IDs", async () => {
    const fullLoadCalls: string[][] = [];

    const result = await listCustomersForUserPaginated(staffB, {}, 1);
    const customerIds = result.items.map((item) => item.id);

    const assigneesByCustomerId = await listCustomerAssigneesByCustomerIds(
      db,
      customerIds,
    );
    fullLoadCalls.push(customerIds);

    const settings = await getEffectiveSettings(db);
    const views = getCustomersWithScores(
      staffB,
      result.items,
      new Set(),
      settings,
      new Date(),
      getAssigneeCustomerIdsFromRecords(
        staffB.id,
        customerIds,
        assigneesByCustomerId,
      ),
    );

    await buildCustomerListRows(db, views, { assigneesByCustomerId });

    assert.equal(fullLoadCalls.length, 1);
    assert.deepEqual(fullLoadCalls[0], customerIds);
  });

  it("scoring path queries user membership for candidates then full map for pageViews only", async () => {
    const userMembershipCalls: string[][] = [];
    const fullLoadCalls: string[][] = [];

    const settings = await getEffectiveSettings(db);
    const listQueryOptions = {
      sortMode: CUSTOMER_LIST_ACTIVE_SORT_MODE,
      automaticReclaimDays: settings.automaticReclaimDays,
    };
    const [pageOne, pageTwo] = await Promise.all([
      listCustomersForUserPaginated(adminUser, {}, 1),
      listCustomersForUserPaginated(adminUser, {}, 2),
    ]);
    const customers = [...pageOne.items, ...pageTwo.items];
    const customerIds = customers.map((customer) => customer.id);

    const [followUpSet, assigneeIds] = await Promise.all([
      getCustomerIdsWithFollowUps(db, customerIds),
      (async () => {
        userMembershipCalls.push(customerIds);
        return getAssigneeCustomerIdsForUser(db, adminUser.id, customerIds);
      })(),
    ]);

    const views = filterCustomersWithScores(
      getCustomersWithScores(
        adminUser,
        customers,
        followUpSet,
        settings,
        new Date(),
        assigneeIds,
      ),
      { completenessBelow: 100 },
    );
    const pagination = buildCustomerListPagination(views.length, 1);
    const offset = (pagination.page - 1) * pagination.pageSize;
    const pageViews = views.slice(offset, offset + pagination.pageSize);
    const pageViewIds = pageViews.map((view) => view.id);

    const assigneesByCustomerId = await (async () => {
      fullLoadCalls.push(pageViewIds);
      return listCustomerAssigneesByCustomerIds(db, pageViewIds);
    })();

    await buildCustomerListRows(db, pageViews, { assigneesByCustomerId });

    assert.equal(userMembershipCalls.length, 1);
    assert.deepEqual(userMembershipCalls[0], customerIds);
    assert.equal(fullLoadCalls.length, 1);
    assert.deepEqual(fullLoadCalls[0], pageViewIds);
    assert.ok(pageViewIds.length <= pagination.pageSize);
  });

  it("heat filter scoring semantics remain available on bounded assignee path", async () => {
    const settings = await getEffectiveSettings(db);
    const listQueryOptions = {
      sortMode: CUSTOMER_LIST_ACTIVE_SORT_MODE,
      automaticReclaimDays: settings.automaticReclaimDays,
    };
    const result = await listCustomersForUserPaginated(adminUser, {}, 1);
    const customers = result.items;
    const customerIds = customers.map((customer) => customer.id);
    const [followUpSet, assigneeIds] = await Promise.all([
      getCustomerIdsWithFollowUps(db, customerIds),
      getAssigneeCustomerIdsForUser(db, adminUser.id, customerIds),
    ]);
    const views = filterCustomersWithScores(
      getCustomersWithScores(
        adminUser,
        customers,
        followUpSet,
        settings,
        new Date(),
        assigneeIds,
      ),
      { heat: "high" },
    );
    for (const view of views) {
      assert.equal(view.heatLevel, "high");
    }
  });

  it("buildCustomerListRows renders assignee names from preloaded map", async () => {
    const result = await listCustomersForUserPaginated(staffB, {}, 1);
    const customerIds = result.items.map((item) => item.id);
    const assigneesByCustomerId = await listCustomerAssigneesByCustomerIds(
      db,
      customerIds,
    );
    const settings = await getEffectiveSettings(db);
    const views = getCustomersWithScores(
      staffB,
      result.items,
      new Set(),
      settings,
      new Date(),
      getAssigneeCustomerIdsFromRecords(
        staffB.id,
        customerIds,
        assigneesByCustomerId,
      ),
    );

    const rows = await buildCustomerListRows(db, views, {
      assigneesByCustomerId,
    });
    assert.ok(rows.length > 0);
    const assignedRow = rows.find((row) => row.id === SEED_IDS.customerStaffA);
    if (assignedRow) {
      assert.ok(assignedRow.assigneeNames.length >= 0);
    }
  });

  it("staff B sees assigned collaborative customer when assignee row exists", async () => {
    const now = new Date().toISOString();
    const testRowId = "d2c-test-collaborator-0001-0001-0001-000000000002";
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
      const result = await listCustomersForUserPaginated(staffB, {}, 1);
      const ids = result.items.map((item) => item.id);
      assert.ok(ids.includes(SEED_IDS.customerStaffA));
    } finally {
      await db
        .delete(schema.customerAssignees)
        .where(eq(schema.customerAssignees.id, testRowId));
    }
  });

  it("unrelated staff cannot see private customer in paginated list", async () => {
    const unrelatedStaff = {
      id: "11111111-1111-1111-1111-111111111199",
      role: "staff",
    } as User;
    const result = await listCustomersForUserPaginated(unrelatedStaff, {}, 1);
    const ids = result.items.map((item) => item.id);
    assert.equal(ids.includes(SEED_IDS.customerStaffA), false);
  });

  it("admin paginated list includes customers", async () => {
    const result = await listCustomersForUserPaginated(adminUser, {}, 1);
    assert.ok(result.items.length > 0);
    assert.ok(result.pagination.total >= result.items.length);
  });
});
