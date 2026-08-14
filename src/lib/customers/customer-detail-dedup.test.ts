import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, getDb } from "@/lib/db";
import {
  listCustomerAssignees,
  type CustomerAssigneeRecord,
} from "@/lib/customers/assignees";
import {
  assertCanConfirmPendingCustomerNameFromAssignees,
  canConfirmPendingCustomerName,
} from "@/lib/customers/confirm-name";
import {
  formatAssigneeDisplayNames,
  resolveCustomerAssigneeNames,
  resolveCustomerAssigneeNamesFromRecords,
  resolveCustomerDetailDisplayNames,
  resolveCustomerUserLabels,
} from "@/lib/customers/user-labels";
import {
  resolveCustomerAccessOptions,
  resolveCustomerAccessOptionsFromAssignees,
} from "@/lib/permissions/customers";
import type { User } from "../../../drizzle/schema/users";

const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

function readDetailPageSource(): string {
  return readFileSync("src/app/(dashboard)/customers/[id]/page.tsx", "utf8");
}

describe("B7-D1 customer detail assignee dedup", () => {
  it("page loads assignees once during bootstrap before access resolution", () => {
    const source = readDetailPageSource();
    assert.match(source, /listCustomerAssignees\(db, id\)/);
    assert.match(source, /resolveCustomerAccessOptionsFromAssignees/);
    assert.match(source, /preloadedAssignees/);
    assert.doesNotMatch(
      source,
      /resolveCustomerAccessOptions\(db, user, id\)/,
    );
    assert.doesNotMatch(source, /resolveCustomerAssigneeNames\(db, id\)/);
  });

  it("staff path uses preloaded assignees for confirm-name and display names", () => {
    const source = readDetailPageSource();
    assert.match(source, /const preloadedAssignees = assigneesTimed\.result/);
    assert.match(source, /preloadedAssignees,/);
    assert.match(source, /displayNamesPromise/);
    assert.match(source, /resolveCustomerDetailDisplayNames\(db, customer, preloadedAssignees\)/);
  });

  it("resolveCustomerAccessOptionsFromAssignees matches DB helper semantics", async () => {
    let dispose: (() => Promise<void>) | undefined;
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    const db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;

    try {
      const assignees = await listCustomerAssignees(db, SEED_IDS.customerStaffA);
      const fromRecords = resolveCustomerAccessOptionsFromAssignees(
        staffA,
        assignees,
      );
      const fromDb = await resolveCustomerAccessOptions(
        db,
        staffA,
        SEED_IDS.customerStaffA,
      );
      assert.deepEqual(fromRecords, fromDb);

      const unrelated = resolveCustomerAccessOptionsFromAssignees(staffB, []);
      assert.deepEqual(unrelated, {});
    } finally {
      bindTestDatabase(null);
      delete process.env.CRM_ALLOW_TEST_DB_BIND;
      await dispose?.();
    }
  });

  it("removed assignee snapshot denies access and confirm-name permission", () => {
    const emptyAssignees: CustomerAssigneeRecord[] = [];
    const access = resolveCustomerAccessOptionsFromAssignees(staffB, emptyAssignees);
    assert.deepEqual(access, {});

    assert.throws(() => {
      assertCanConfirmPendingCustomerNameFromAssignees(
        staffB,
        {
          id: SEED_IDS.customerStaffA,
          ownerId: SEED_IDS.staffA,
          nameStatus: "pending",
        } as never,
        emptyAssignees,
      );
    });
  });
});

describe("B7-D1 customer detail display-name dedup", () => {
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

  it("consolidates owner, creator, and assignee IDs into one users lookup", async () => {
    const customer = await getDb()
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, SEED_IDS.customerStaffA))
      .limit(1);
    const row = customer[0];
    assert.ok(row);

    const assignees = await listCustomerAssignees(db, SEED_IDS.customerStaffA);
    const combined = await resolveCustomerDetailDisplayNames(db, row, assignees);
    const [labels, assigneeNames] = await Promise.all([
      resolveCustomerUserLabels(db, row),
      resolveCustomerAssigneeNames(db, SEED_IDS.customerStaffA),
    ]);

    assert.equal(combined.ownerName, labels.ownerName);
    assert.equal(combined.createdByName, labels.createdByName);
    assert.deepEqual(combined.assigneeNames, assigneeNames);
  });

  it("preserves assignee display-name ordering", async () => {
    const assignees = await listCustomerAssignees(db, SEED_IDS.customerStaffA);
    const combined = await resolveCustomerDetailDisplayNames(
      db,
      {
        ownerId: SEED_IDS.staffA,
        createdBy: SEED_IDS.admin,
      },
      assignees,
    );
    const fromRecords = await resolveCustomerAssigneeNamesFromRecords(
      db,
      assignees,
    );
    assert.deepEqual(combined.assigneeNames, fromRecords);
  });

  it("deduplicates duplicate user IDs before lookup", () => {
    const assignees: CustomerAssigneeRecord[] = [
      {
        id: "a1",
        customerId: "c1",
        userId: "u1",
        role: "primary",
        assignedBy: null,
        assignedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const names = formatAssigneeDisplayNames(assignees, new Map([["u1", "Alex"]]));
    assert.deepEqual(names, ["Alex"]);
  });
});

describe("B7-D1 follow-up scoring dedup", () => {
  it("loads follow-ups in chain after access and feeds scoring", () => {
    const source = readDetailPageSource();
    const body = source.slice(source.indexOf("export default async function"));
    const accessIndex = body.indexOf("resolveCustomerAccessOptionsFromAssignees");
    const chainBlock = body.slice(
      body.indexOf("const followUpsChainPromise"),
      body.indexOf("const scoringPromise"),
    );
    const enrichIndex = body.indexOf("enrichCustomerResponse(db, user, customer");
    assert.ok(accessIndex >= 0);
    assert.match(chainBlock, /assertCanViewFollowUps/);
    assert.ok(enrichIndex > body.indexOf("const followUpsChainPromise"));
    assert.match(source, /hasFollowUp/);
  });
});
