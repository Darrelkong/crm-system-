import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, getDb } from "@/lib/db";
import { getCustomerById } from "@/lib/customers/queries";
import {
  D1_MAX_COMPOUND_SELECT_TERMS,
  loadActorNamesForCustomer,
  loadTaskAuditsForCustomer,
} from "@/lib/customers/timeline/service";

function readTimelineServiceSource(): string {
  return readFileSync("src/lib/customers/timeline/service.ts", "utf8");
}

/** F4-safe actor resolution: collect IDs from loaded Timeline rows, then users lookup. */
async function loadActorNamesLegacyFromTimelineRows(
  db: ReturnType<typeof getDb>,
  customerId: string,
  createdBy: string | null,
): Promise<Map<string, string>> {
  const [customerAudits, fieldChanges, followUps, tasks, approvals, taskAudits] =
    await Promise.all([
      db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.entityType, "customer"),
            eq(schema.auditLogs.entityId, customerId),
          ),
        )
        .orderBy(desc(schema.auditLogs.createdAt)),
      db
        .select()
        .from(schema.fieldChangeLogs)
        .where(eq(schema.fieldChangeLogs.customerId, customerId))
        .orderBy(desc(schema.fieldChangeLogs.changedAt)),
      db
        .select()
        .from(schema.followUps)
        .where(eq(schema.followUps.customerId, customerId))
        .orderBy(desc(schema.followUps.followUpTime)),
      db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.customerId, customerId))
        .orderBy(desc(schema.tasks.createdAt)),
      db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.customerId, customerId))
        .orderBy(desc(schema.approvals.createdAt)),
      loadTaskAuditsForCustomer(db, customerId),
    ]);

  const actorIds = [
    ...customerAudits.map((r) => r.userId),
    ...taskAudits.map((r) => r.userId),
    ...fieldChanges.map((r) => r.changedBy),
    ...followUps.map((r) => r.userId),
    ...tasks.map((r) => r.createdBy),
    ...approvals.map((r) => r.requestedBy),
    ...approvals.map((r) => r.reviewedBy),
    createdBy,
  ].filter((id): id is string => !!id);

  const uniqueIds = [...new Set(actorIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, uniqueIds));

  return new Map(rows.map((row) => [row.id, row.displayName]));
}

describe("F5-F1 D1 actor-name SQL regression", () => {
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

  it("documents the verified D1 compound SELECT branch limit", () => {
    assert.equal(D1_MAX_COMPOUND_SELECT_TERMS, 5);
  });

  it("loadActorNamesForCustomer executes on local D1 without compound SELECT error", async () => {
    const db = getDb();
    const customer = await getCustomerById(SEED_IDS.customerStaffA);
    assert.ok(customer);

    const actorMap = await loadActorNamesForCustomer(
      db,
      customer.id,
      customer.createdBy,
    );

    assert.ok(actorMap instanceof Map);
  });

  it("matches F4 legacy actor-name map for seeded customer", async () => {
    const db = getDb();
    const customer = await getCustomerById(SEED_IDS.customerStaffA);
    assert.ok(customer);

    const [legacy, optimized] = await Promise.all([
      loadActorNamesLegacyFromTimelineRows(
        db,
        customer.id,
        customer.createdBy,
      ),
      loadActorNamesForCustomer(db, customer.id, customer.createdBy),
    ]);

    assert.deepEqual(
      [...optimized.entries()].sort(([a], [b]) => a.localeCompare(b)),
      [...legacy.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
  });

  it("includes createdBy even when absent from event actor sources", async () => {
    const db = getDb();
    const customer = await getCustomerById(SEED_IDS.customerStaffA);
    assert.ok(customer);
    assert.ok(customer.createdBy);

    const actorMap = await loadActorNamesForCustomer(
      db,
      customer.id,
      customer.createdBy,
    );

    const creator = await db
      .select({ displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, customer.createdBy))
      .limit(1);

    assert.equal(actorMap.get(customer.createdBy), creator[0]?.displayName);
  });

  it("uses split compound subqueries within D1-safe branch counts", () => {
    const source = readTimelineServiceSource();
    const fn = source.slice(
      source.indexOf("export async function loadActorNamesForCustomer"),
      source.indexOf("function actorFromMap"),
    );

    assert.match(fn, /actorIdsGroupA/);
    assert.match(fn, /actorIdsGroupB/);
    assert.doesNotMatch(
      fn,
      /reviewed_by AS actor_id[\s\S]*UNION[\s\S]*created_by AS actor_id FROM tasks/,
    );

    const groupA = fn.slice(
      fn.indexOf("const actorIdsGroupA"),
      fn.indexOf("const actorIdsGroupB"),
    );
    const groupB = fn.slice(
      fn.indexOf("const actorIdsGroupB"),
      fn.indexOf("const createdByFilter"),
    );

    const countUnionBranches = (block: string) =>
      (block.match(/\bUNION\b/g) ?? []).length + 1;

    assert.ok(
      countUnionBranches(groupA) <= D1_MAX_COMPOUND_SELECT_TERMS,
      `group A has ${countUnionBranches(groupA)} SELECT terms`,
    );
    assert.ok(
      countUnionBranches(groupB) <= D1_MAX_COMPOUND_SELECT_TERMS,
      `group B has ${countUnionBranches(groupB)} SELECT terms`,
    );
  });
});
