import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("dashboard creator metrics wiring", () => {
  const staffDash = () => read("src/lib/reports/staff-dashboard.ts");
  const adminDash = () => read("src/lib/reports/admin-dashboard.ts");
  const staffReports = () => read("src/lib/reports/staff-reports.ts");
  const adminClient = () =>
    read("src/components/dashboard/admin-dashboard-client.tsx");
  const staffClient = () =>
    read("src/components/dashboard/staff-dashboard-client.tsx");
  const widgets = () =>
    read("src/components/dashboard/dashboard-widgets.tsx");
  const types = () => read("src/lib/reports/types.ts");

  it("Staff Dashboard month new uses createdBy + deletedAt IS NULL", () => {
    const source = staffDash();
    assert.match(
      source,
      /eq\(schema\.customers\.createdBy, user\.id\)[\s\S]*?isNull\(schema\.customers\.deletedAt\)[\s\S]*?gte\(schema\.customers\.createdAt, monthStart\)[\s\S]*?lt\(schema\.customers\.createdAt, monthEndExclusive\)/,
    );
    assert.doesNotMatch(source, /normalCustomerListStatusWhere/);
    assert.doesNotMatch(source, /ownedNormalCustomerListWhere/);
    const monthWhere = source.match(
      /eq\(schema\.customers\.createdBy, user\.id\),\s*isNull\(schema\.customers\.deletedAt\),\s*gte\(schema\.customers\.createdAt, monthStart\),\s*lt\(schema\.customers\.createdAt, monthEndExclusive\),/,
    )?.[0];
    assert.ok(monthWhere);
    assert.doesNotMatch(monthWhere!, /ownerId/);
    assert.doesNotMatch(monthWhere!, /status/);
    assert.doesNotMatch(monthWhere!, /COALESCE|ownerId\s*\?\?|fallback/i);
  });

  it("Staff Dashboard month new matches Staff Reports month attribution", () => {
    const reports = staffReports();
    assert.match(
      reports,
      /createdNewCustomerFilter[\s\S]*?eq\(schema\.customers\.createdBy, userId\)[\s\S]*?isNull\(schema\.customers\.deletedAt\)/,
    );
    assert.match(
      reports,
      /createdNewCustomerFilter\(user\.id, monthStart, monthEndExclusive\)/,
    );
    const dash = staffDash();
    assert.match(dash, /eq\(schema\.customers\.createdBy, user\.id\)/);
    assert.match(dash, /isNull\(schema\.customers\.deletedAt\)/);
    assert.match(dash, /getBusinessMonthRange/);
  });

  it("Staff Dashboard response shape and other KPIs stay owner/active or unchanged", () => {
    const source = staffDash();
    assert.match(
      source,
      /ownedActiveFilter\s*=\s*and\(\s*eq\(schema\.customers\.ownerId, user\.id\),\s*eq\(schema\.customers\.status, "active"\),\s*\)/,
    );
    assert.match(source, /myFollowUpsThisMonth:/);
    assert.match(source, /publicPoolClaimStatus:/);
    assert.match(staffClient(), /myNewCustomersThisMonth/);
    assert.match(staffClient(), /newClientsThisMonthCreatorHint/);
    assert.doesNotMatch(staffClient(), /fetch\(|\/api\/reports/);
  });

  it("Admin company month new is derived from creator breakdown sum (single source)", () => {
    const source = adminDash();
    assert.match(
      source,
      /const newCustomersThisMonth = newCustomersByCreatorThisMonth\.reduce\(/,
    );
    assert.doesNotMatch(
      source,
      /creatorSum !== newCustomersThisMonth[\s\S]*?throw new Error/,
    );
    assert.doesNotMatch(source, /throw new Error\(\s*`Admin dashboard creator metrics mismatch/);
    // No standalone company-new count query left in Promise.all.
    assert.doesNotMatch(
      source,
      /pendingApprovalsRow,\s*newCustomersRow,/,
    );
    // Creator join still excludes recycle and attributes by createdBy.
    assert.match(
      source,
      /eq\(schema\.customers\.createdBy, schema\.users\.id\)[\s\S]*?isNull\(schema\.customers\.deletedAt\)/,
    );
    assert.match(source, /gte\(schema\.customers\.createdAt, monthStart\)/);
    assert.match(source, /lt\(schema\.customers\.createdAt, monthEndExclusive\)/);
    assert.doesNotMatch(source, /ownerId fallback|COALESCE\(.*ownerId/i);
    assert.doesNotMatch(source, /unknown|other.*creator/i);
  });

  it("Admin creator breakdown uses users LEFT JOIN customers with no LIMIT/Top-N", () => {
    const source = adminDash();
    assert.match(source, /\.from\(schema\.users\)/);
    assert.match(source, /\.leftJoin\(\s*schema\.customers/);
    assert.match(
      source,
      /eq\(schema\.customers\.createdBy, schema\.users\.id\)/,
    );
    assert.match(source, /isNull\(schema\.customers\.deletedAt\)/);
    assert.match(source, /count\(\$\{schema\.customers\.id\}\)/);
    assert.doesNotMatch(source, /\.limit\(/);
    assert.doesNotMatch(source, /slice\(0,\s*5\)|Top\s*5/i);
    assert.match(source, /isFormer:\s*row\.deletedAt != null/);
    assert.match(source, /role:\s*row\.role/);
  });

  it("Admin types and API remain additive; routes unchanged", () => {
    const t = types();
    assert.match(t, /export type CreatorNewCustomerCount/);
    assert.match(t, /newCustomersByCreatorThisMonth:\s*CreatorNewCustomerCount\[\]/);
    assert.match(t, /newCustomersThisMonth:\s*number/);
    assert.match(t, /role:\s*"admin"\s*\|\s*"staff"/);
    assert.match(t, /isFormer:\s*boolean/);

    const adminApi = read("src/app/api/reports/admin-dashboard/route.ts");
    const staffApi = read("src/app/api/reports/staff-dashboard/route.ts");
    assert.match(adminApi, /getAdminDashboardStats/);
    assert.match(staffApi, /getStaffDashboardStats/);
    assert.doesNotMatch(adminApi, /newCustomersByCreator/);
    assert.match(adminApi, /force-dynamic/);
  });

  it("Admin Dashboard UI does not render member ranking tables", () => {
    const client = adminClient();
    assert.doesNotMatch(client, /RankingTable/);
    assert.doesNotMatch(client, /data-dashboard-creator-ranking/);
    assert.doesNotMatch(client, /staffClientRanking|staffFollowUpRanking/);
    assert.doesNotMatch(client, /第\s*1\s*名|Top Staff|排行榜|冠军/);
    assert.doesNotMatch(client, /newCustomersByCreatorThisMonth/);
    assert.doesNotMatch(client, /customersByOwner|followUpsByStaffThisMonth/);
  });

  it("RankingTable remains unused by Admin Reports; distribution uses neutral table", () => {
    const w = widgets();
    assert.match(w, /scrollable\?: boolean/);
    assert.match(w, /badges\?: string\[\]/);
    assert.match(w, /note\?: string/);
    assert.match(w, /scrollable \? "max-h-80 overflow-y-auto/);
    const adminReportsClient = read(
      "src/components/reports/admin-reports-client.tsx",
    );
    assert.doesNotMatch(adminReportsClient, /RankingTable|ranking-table-head/);
    assert.match(adminReportsClient, /data-reports-staff-distribution/);
    assert.match(
      read("src/lib/reports/admin-reports.ts"),
      /sortTeamMembersStable/,
    );
    assert.doesNotMatch(
      read("src/lib/reports/admin-reports.ts"),
      /customersByOwner[\s\S]*orderBy\(desc\(count\(\)\)\)/,
    );
  });

  it("does not modify Reports Round B, dates, or package.json", () => {
    const staffReportsSrc = staffReports();
    assert.match(staffReportsSrc, /createdNewCustomerFilter/);
    assert.match(staffReportsSrc, /ownedActiveFilter/);

    const dates = read("src/lib/reports/dates.ts");
    assert.match(dates, /BUSINESS_UTC_OFFSET_MS = 8 \* 60 \* 60 \* 1000/);

    const pkg = read("package.json");
    assert.doesNotMatch(pkg, /recharts|chart\.js/i);

    const adminReports = read("src/lib/reports/admin-reports.ts");
    assert.match(adminReports, /ne\(schema\.customers\.status, "archived"\)/);
  });

  it("updates dashboard i18n keys consistently without technical field names", () => {
    const zhHant = read("src/i18n/locales/zh-Hant.ts");
    const zhHans = read("src/i18n/locales/zh-Hans.ts");
    const en = read("src/i18n/locales/en.ts");

    for (const locale of [zhHant, zhHans, en]) {
      for (const key of [
        "newCustomersByCreatorThisMonth",
        "newCustomersByCreatorNote",
        "staffClientRankingNote",
        "newClientsThisMonthCompanyHint",
        "newClientsThisMonthCreatorHint",
        "formerMemberBadge",
        "noCreatorNewCustomerData",
        "columnNewCustomerCount",
      ]) {
        assert.match(locale, new RegExp(`${key}:`));
      }
      const note =
        locale.match(
          /newCustomersByCreatorNote:\s*\n?\s*"([^"]+)"/,
        )?.[1] ?? "";
      assert.ok(note.length > 0);
      assert.doesNotMatch(note, /createdBy|ownerId|deletedAt/);
    }

    assert.match(zhHant, /本月新增客戶（按建立者）/);
    assert.match(zhHans, /本月新增客户（按创建人）/);
    assert.match(en, /New customers by creator this month/);
    assert.match(zhHant, /formerMemberBadge:\s*"已離職"/);
    assert.match(zhHans, /formerMemberBadge:\s*"已离职"/);
  });
});
