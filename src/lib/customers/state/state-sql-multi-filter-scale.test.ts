import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { Customer } from "../../../../drizzle/schema/customers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { CUSTOMER_LIST_PAGE_SIZE } from "@/lib/customers/queries";
import { NOW, hkDaysAgoIso } from "./state-fixtures.test-helper";
import {
  evaluateCustomerStateReference,
  filterCustomerIdsReference,
} from "./state-list-reference";
import {
  countCustomersMatchingStateFilter,
  listCustomerIdsMatchingStateFilter,
  listCustomerIdsMatchingStateFilterPaginated,
} from "./state-list-sql";
import type { StateListFilter } from "./state-sql-dimensions";

const SCALE_PREFIX = "77777777-7777-7777-7777-mf-";
const FIXED_NOW = NOW;
const SCALE_SIZE = 1000;
const PAGE = 2;

const MULTI_FILTER: StateListFilter = {
  profileVerdict: "minor_gaps",
  followUpSla: "overdue",
  engagement: "cooling",
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

function scaleId(index: number): string {
  return `${SCALE_PREFIX}${String(index).padStart(4, "0")}`;
}

function makeScaleCustomer(index: number): Customer {
  const mod = index % 10;
  const missingOptional = mod % 3 === 0;
  return {
    id: scaleId(index),
    customerCode: null,
    customerName: `MF Scale ${index}`,
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: `1390000${String(index).padStart(4, "0")}`,
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: "PROJ-1",
    primaryConcern: null,
    notes: "notes",
    preferredName: null,
    gender: null,
    ageRange: null,
    preferredLanguage: null,
    preferredContactMethod: missingOptional ? null : "phone",
    occupation: null,
    companyName: null,
    jobTitle: null,
    targetCountryOrRegion: null,
    salesStage: mod === 0 ? "on_hold" : mod === 1 ? "closed_won" : "contacted",
    ownerId: mod === 2 ? null : SEED_IDS.staffA,
    status: mod === 2 ? "public_pool" : "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    lastFollowUpAt: null,
    lastValidFollowUpAt:
      mod === 3 ? null : hkDaysAgoIso(12 + (index % 3), FIXED_NOW),
    nextFollowUpAt: null,
    reclamationCycleStartedAt: null,
    reclaimRuleGraceUntil: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: mod === 0 ? 1 : 0,
    pinnedAt: null,
    pinnedSource: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    createdAt: hkDaysAgoIso(30, FIXED_NOW),
    updatedAt: FIXED_NOW.toISOString(),
  } as Customer;
}

describe("Customer State V2 SQL multi-filter scale (~1000 rows)", () => {
  before(async () => {
    const proxy = await getPlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;

    await db
      .delete(schema.customers)
      .where(like(schema.customers.id, `${SCALE_PREFIX}%`));

    const batch: Customer[] = [];
    for (let index = 0; index < SCALE_SIZE; index += 1) {
      batch.push(makeScaleCustomer(index));
      if (batch.length === 100) {
        for (const customer of batch) {
          await db.insert(schema.customers).values(customer);
        }
        batch.length = 0;
      }
    }
    for (const customer of batch) {
      await db.insert(schema.customers).values(customer);
    }
  });

  after(async () => {
    await db
      .delete(schema.customers)
      .where(like(schema.customers.id, `${SCALE_PREFIX}%`));
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("D1 evaluates 3-filter intersection with JS parity and bounded pagination", async () => {
    const baseWhere = like(schema.customers.id, `${SCALE_PREFIX}%`);
    const options = {
      now: FIXED_NOW,
      automaticReclaimDays: 55,
      businessTimezone: "Asia/Hong_Kong" as const,
    };

    const scopedRows = await db
      .select()
      .from(schema.customers)
      .where(baseWhere);
    const snapshots = scopedRows.map((customer) =>
      evaluateCustomerStateReference(customer, [], FIXED_NOW, {
        automaticReclaimDays: 55,
      }),
    );
    const refIds = filterCustomerIdsReference(snapshots, MULTI_FILTER).sort();

    const sqlCount = await countCustomersMatchingStateFilter(
      db,
      baseWhere,
      MULTI_FILTER,
      options,
    );
    assert.equal(sqlCount, refIds.length, "SQL count must match JS reference");
    assert.ok(sqlCount > 0, "expected overlapping 3-filter fixtures");
    assert.ok(sqlCount < SCALE_SIZE, "filters should exclude most fixtures");

    const sqlIds = (
      await listCustomerIdsMatchingStateFilter(
        db,
        baseWhere,
        MULTI_FILTER,
        options,
      )
    ).sort();
    assert.deepEqual(sqlIds, refIds, "SQL ids must match JS reference");

    const page = await listCustomerIdsMatchingStateFilterPaginated(
      db,
      baseWhere,
      MULTI_FILTER,
      PAGE,
      options,
    );
    assert.equal(page.pagination.total, sqlCount);
    assert.equal(page.pagination.pageSize, CUSTOMER_LIST_PAGE_SIZE);
    assert.ok(page.ids.length <= CUSTOMER_LIST_PAGE_SIZE);
    assert.ok(page.ids.length <= sqlCount);
    assert.ok(
      page.ids.length < sqlCount || sqlCount <= CUSTOMER_LIST_PAGE_SIZE,
      "paginated query must return at most pageSize rows",
    );

    const pageOnly = await listCustomerIdsMatchingStateFilter(
      db,
      baseWhere,
      MULTI_FILTER,
      {
        ...options,
        limit: CUSTOMER_LIST_PAGE_SIZE,
        offset: (PAGE - 1) * CUSTOMER_LIST_PAGE_SIZE,
      },
    );
    assert.equal(pageOnly.length, page.ids.length);
    assert.ok(
      pageOnly.length <= CUSTOMER_LIST_PAGE_SIZE,
      "Worker receives bounded page only, not full match set",
    );
  });
});
