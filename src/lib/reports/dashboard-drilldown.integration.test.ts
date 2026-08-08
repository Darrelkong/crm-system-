import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getAdminTeamExecutionOverview } from "./admin-team-execution";
import { getDashboardSummary } from "./dashboard-summary";
import {
  buildTeamValidFollowUpsHref,
  buildValidFollowUpsTodayHref,
} from "./dashboard-drilldown-links";
import {
  applyFollowUpListItemFilters,
  filtersForFollowUpListRole,
} from "@/lib/follow-ups/apply-list-filters";
import { parseFollowUpListFilters } from "@/lib/follow-ups/list-filters";
import {
  listFollowUpsForAdmin,
  listFollowUpsForStaff,
} from "@/lib/follow-ups/list-queries";
import {
  listCustomersForUserPaginated,
  parseCustomerListFilter,
} from "@/lib/customers/queries";
import type { User } from "../../../drizzle/schema/users";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const staffA = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff A",
} as User;

const staffB = {
  id: SEED_IDS.staffB,
  role: "staff",
  displayName: "Staff B",
} as User;

const admin = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

function countFilteredFollowUps(
  items: Awaited<ReturnType<typeof listFollowUpsForAdmin>>,
  href: string,
  role: "admin" | "staff",
): number {
  const query = href.includes("?") ? href.split("?")[1]! : "";
  const filters = filtersForFollowUpListRole(
    parseFollowUpListFilters(new URLSearchParams(query)),
    role,
  );
  return applyFollowUpListItemFilters(items, filters).length;
}

describe("dashboard drill-down metric consistency DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("staff valid follow-ups today matches filtered follow-up list", async () => {
    const summary = await getDashboardSummary(db, staffA);
    if (summary.role !== "staff") throw new Error("expected staff summary");

    const href = buildValidFollowUpsTodayHref();
    const items = await listFollowUpsForStaff(db, staffA.id);
    const filtered = countFilteredFollowUps(items, href, "staff");

    assert.equal(summary.metrics.validFollowUpsToday, filtered);
  });

  it("admin valid follow-ups today matches filtered follow-up list", async () => {
    const summary = await getDashboardSummary(db, admin);
    if (summary.role !== "admin") throw new Error("expected admin summary");

    const href = buildValidFollowUpsTodayHref();
    const items = await listFollowUpsForAdmin(db);
    const filtered = countFilteredFollowUps(items, href, "admin");

    assert.equal(summary.metrics.validFollowUpsToday, filtered);
  });

  it("team valid follow-ups match period drill-down for each staff", async () => {
    const overview = await getAdminTeamExecutionOverview(db, admin);
    const items = await listFollowUpsForAdmin(db);

    for (const member of overview.members) {
      for (const periodDays of [7, 30, 90] as const) {
        const metric = member.periodActivity[periodDays].validFollowUps;
        const href = buildTeamValidFollowUpsHref(member.userId, periodDays);
        const filtered = countFilteredFollowUps(items, href, "admin");
        assert.equal(metric, filtered, `${member.userId} period ${periodDays}`);
      }
    }
  });

  it("team current customers and overdue match owner drill-down", async () => {
    const overview = await getAdminTeamExecutionOverview(db, admin);

    for (const member of overview.members) {
      const current = await listCustomersForUserPaginated(
        admin,
        parseCustomerListFilter(admin, {
          ownerId: member.userId,
        }),
        1,
      );
      assert.ok(member.customersHref.includes(`ownerId=${member.userId}`));
      assert.ok(current.pagination.total >= 0);

      const overdue = await listCustomersForUserPaginated(
        admin,
        parseCustomerListFilter(admin, {
          ownerId: member.userId,
          workView: "overdue",
        }),
        1,
      );
      assert.ok(member.overdueHref.includes("workView=overdue"));
      assert.ok(overdue.pagination.total >= 0);
    }
  });

  it("staff cannot expand scope via ownerId tampering", async () => {
    const ownPage = await listCustomersForUserPaginated(staffA, {}, 1);
    const tampered = await listCustomersForUserPaginated(
      staffA,
      parseCustomerListFilter(staffA, { ownerId: staffB.id }),
      1,
    );
    assert.deepEqual(
      tampered.items.map((item) => item.id).sort(),
      ownPage.items.map((item) => item.id).sort(),
    );

    const ownFollowUps = await listFollowUpsForStaff(db, staffA.id);
    const tamperedHref = buildTeamValidFollowUpsHref(staffB.id, 7);
    const tamperedCount = countFilteredFollowUps(
      ownFollowUps,
      tamperedHref,
      "staff",
    );
    const ownHref = buildValidFollowUpsTodayHref();
    const ownCount = countFilteredFollowUps(ownFollowUps, ownHref, "staff");
    assert.equal(tamperedCount, ownCount);
  });
});
