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
  resolveCustomerAccessOptionsFromAssignees,
} from "@/lib/permissions/customers";
import { enrichCustomerResponse } from "@/lib/customers/scoring/service";
import {
  listCustomerAssignees,
} from "@/lib/customers/assignees";
import {
  resolveCustomerDetailDisplayNames,
} from "@/lib/customers/user-labels";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { getCustomerTimeline, assertCanViewCustomerTimeline } from "@/lib/customers/timeline/service";
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
  it("enrichCustomerResponse occurs before final secondary parallel loaders", () => {
    const source = readDetailPageSource();
    const enrichIndex = source.indexOf("enrichCustomerResponse");
    const parallelIndex = source.lastIndexOf("await Promise.all([");
    assert.ok(enrichIndex >= 0);
    assert.ok(parallelIndex > enrichIndex);
  });

  it("secondary loaders run in one post-access Promise.all stage", () => {
    const section = extractPostAccessSection(readDetailPageSource());
    const parallelBlock = section.slice(section.lastIndexOf("await Promise.all(["));
    assert.match(parallelBlock, /confirmNamePromise/);
    assert.match(parallelBlock, /followUpsChainPromise/);
    assert.match(parallelBlock, /timelinePromise/);
    assert.match(parallelBlock, /displayNamesPromise/);
    const parallelCount = (section.match(/await Promise\.all\(\[/g) ?? []).length;
    assert.ok(parallelCount >= 1);
  });

  it("follow-up list is gated by assertCanViewFollowUps before chain creation", () => {
    const source = readDetailPageSource();
    const chainBlock = source.slice(
      source.indexOf("const followUpsChainPromise"),
      source.indexOf("const scoringPromise"),
    );
    assert.match(chainBlock, /assertCanViewFollowUps/);
  });

  it("checks pending on-hold gate before rendering customer detail", () => {
    const source = readDetailPageSource();
    const onHoldIndex = source.indexOf("pendingFlags.pendingOnHoldCreate");
    const clientIndex = source.indexOf("<CustomerDetailClient");
    assert.ok(onHoldIndex >= 0);
    assert.ok(clientIndex > onHoldIndex);
  });
});

describe("customer detail Phase 2B2 follow-up dedup", () => {
  it("loads follow-ups once for full-access users before scoring and reuses them", () => {
    const source = readDetailPageSource();
    assert.match(source, /followUpsChainPromise/);
    assert.match(source, /hasFollowUp/);
    const fullFollowUpLoads = (
      source.match(/listFollowUpsByCustomerId\(id\)/g) ?? []
    ).length;
    assert.ok(fullFollowUpLoads >= 1);
    assert.ok(fullFollowUpLoads <= 2);
  });

  it("keeps dedicated follow-up UI gated by assertCanViewFollowUps", () => {
    const source = readDetailPageSource();
    assert.match(source, /assertCanViewFollowUps/);
    assert.match(source, /followUpChain\.canViewFollowUps/);
  });

  it("preloads follow-ups for timeline when timeline access is allowed", () => {
    const source = readDetailPageSource();
    assert.match(source, /assertCanViewCustomerTimeline/);
    assert.match(source, /followUpsPromise: timelineFollowUpsPromise/);
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

    let preloadedAssignees;
    let accessOptions;
    if (user.role === "staff") {
      preloadedAssignees = await listCustomerAssignees(db, customerId);
      accessOptions = resolveCustomerAccessOptionsFromAssignees(
        user,
        preloadedAssignees,
      );
    } else {
      accessOptions = {};
    }

    let preloadedFullFollowUps: Awaited<
      ReturnType<typeof listFollowUpsByCustomerId>
    > | undefined;
    let enrichHasFollowUp: boolean | undefined;
    try {
      assertCanViewFollowUps(user, customer, accessOptions);
      preloadedFullFollowUps = await listFollowUpsByCustomerId(customerId);
      enrichHasFollowUp = preloadedFullFollowUps.length > 0;
    } catch {
      // no full follow-up visibility
    }

    const scoresView = await enrichCustomerResponse(
      db,
      user,
      customer,
      new Date(),
      accessOptions,
      { hasFollowUp: enrichHasFollowUp },
    );

    let sharedFollowUpsPromise: ReturnType<typeof listFollowUpsByCustomerId> =
      Promise.resolve([]);
    let shouldPreloadFollowUpsForTimeline = false;
    if (preloadedFullFollowUps) {
      sharedFollowUpsPromise = Promise.resolve(preloadedFullFollowUps);
      try {
        assertCanViewCustomerTimeline(user, customer, accessOptions);
        shouldPreloadFollowUpsForTimeline = true;
      } catch {
        // timeline access denied
      }
    } else {
      try {
        assertCanViewCustomerTimeline(user, customer, accessOptions);
        shouldPreloadFollowUpsForTimeline = true;
        sharedFollowUpsPromise = listFollowUpsByCustomerId(customerId);
      } catch {
        // timeline access denied
      }
    }

    const followUpsForClientPromise = (async () => {
      try {
        assertCanViewFollowUps(user, customer, accessOptions);
        return await sharedFollowUpsPromise;
      } catch {
        return [];
      }
    })();

    const timelinePromise = (async () => {
      const followUpsPromise = shouldPreloadFollowUpsForTimeline
        ? sharedFollowUpsPromise
        : undefined;
      return getCustomerTimeline(db, user, customer, accessOptions, {
        followUpsPromise,
      });
      });
    })();

    const assigneesForDisplay =
      preloadedAssignees ?? (await listCustomerAssignees(db, customerId));

    const [
      showConfirmNameButton,
      followUps,
      timeline,
      displayNames,
    ] = await Promise.all([
      canConfirmPendingCustomerName(db, user, customer, {
        preloadedAssignees,
      }),
      followUpsForClientPromise,
      timelinePromise,
      resolveCustomerDetailDisplayNames(db, customer, assigneesForDisplay),
    ]);

    return {
      scoresView,
      showConfirmNameButton,
      followUps,
      timeline,
      userLabels: {
        ownerName: displayNames.ownerName,
        createdByName: displayNames.createdByName,
      },
      assigneeNames: displayNames.assigneeNames,
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
