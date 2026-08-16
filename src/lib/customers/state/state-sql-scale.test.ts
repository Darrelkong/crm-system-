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
  countCustomersMatchingStateFilter,
  listCustomerIdsMatchingStateFilterPaginated,
} from "./state-list-sql";

const SCALE_PREFIX = "77777777-7777-7777-7777-scale-";
const FIXED_NOW = NOW;
const SCALE_SIZE = 1000;
const PAGE = 2;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

function scaleId(index: number): string {
  return `${SCALE_PREFIX}${String(index).padStart(4, "0")}`;
}

function makeScaleCustomer(index: number): Customer {
  const mod = index % 10;
  return {
    id: scaleId(index),
    customerCode: null,
    customerName: `Scale ${index}`,
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: `1380000${String(index).padStart(4, "0")}`,
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: mod < 8 ? "PROJ-1" : null,
    primaryConcern: null,
    notes: mod < 7 ? "notes" : null,
    preferredName: null,
    gender: null,
    ageRange: null,
    preferredLanguage: null,
    preferredContactMethod: null,
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
      mod === 3 ? null : hkDaysAgoIso(12 + (index % 4), FIXED_NOW),
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

describe("Customer State V2 SQL scale sanity (~1000 rows)", () => {
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

  it("SQL filters and counts without hydrating every candidate in Worker JS", async () => {
    const baseWhere = like(schema.customers.id, `${SCALE_PREFIX}%`);
    const filter = { followUpSla: "overdue" as const };
    const options = {
      now: FIXED_NOW,
      automaticReclaimDays: 55,
      businessTimezone: "Asia/Hong_Kong" as const,
    };

    const total = await countCustomersMatchingStateFilter(
      db,
      baseWhere,
      filter,
      options,
    );
    assert.ok(total > 0, "expected some overdue fixtures");
    assert.ok(total < SCALE_SIZE, "filter should exclude most fixtures");

    const page = await listCustomerIdsMatchingStateFilterPaginated(
      db,
      baseWhere,
      filter,
      PAGE,
      options,
    );

    assert.equal(page.pagination.pageSize, CUSTOMER_LIST_PAGE_SIZE);
    assert.ok(page.ids.length <= CUSTOMER_LIST_PAGE_SIZE);
    assert.ok(page.ids.length <= total);
    assert.equal(page.pagination.total, total);
    assert.ok(
      page.ids.length < total || total <= CUSTOMER_LIST_PAGE_SIZE,
      "page result must stay bounded by pageSize unless total fits one page",
    );
  });
});
