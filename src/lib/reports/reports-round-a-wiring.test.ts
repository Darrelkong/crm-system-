import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("reports Round A UX wiring", () => {
  const adminClient = () =>
    read("src/components/reports/admin-reports-client.tsx");
  const staffClient = () =>
    read("src/components/reports/staff-reports-client.tsx");
  const recent = () =>
    read("src/components/reports/recent-follow-ups-list.tsx");
  const widgets = () =>
    read("src/components/dashboard/dashboard-widgets.tsx");
  const pageIntro = () => read("src/components/ui/page-intro.tsx");

  it("does not modify Admin reports SQL, recent follow-ups, or dates", () => {
    // Round A UI must not rewrite these files' query semantics.
    // Staff new-customer / stage SQL is covered by Round B tests.
    const admin = read("src/lib/reports/admin-reports.ts");
    const staff = read("src/lib/reports/staff-reports.ts");
    const recentSql = read("src/lib/reports/recent-follow-ups.ts");
    const dates = read("src/lib/reports/dates.ts");

    assert.match(admin, /ne\(schema\.customers\.status, "archived"\)/);
    assert.match(admin, /eq\(schema\.customers\.status, "active"\)/);
    assert.match(admin, /followUpTime/);
    assert.match(staff, /eq\(schema\.followUps\.userId, userId\)/);
    assert.match(staff, /eq\(schema\.customers\.status, "active"\)/);
    assert.match(staff, /listRecentFollowUpsForStaff/);
    assert.match(recentSql, /RECENT_FOLLOW_UP_LIMIT = 10/);
    assert.match(recentSql, /orderBy\(desc\(schema\.followUps\.followUpTime\)\)/);
    assert.doesNotMatch(recentSql, /fetch\(/);
    assert.match(dates, /BUSINESS_UTC_OFFSET_MS = 8 \* 60 \* 60 \* 1000/);
    assert.match(dates, /getBusinessWeekRange/);
  });

  it("does not add reports API usage or client fetch", () => {
    assert.doesNotMatch(adminClient(), /fetch\(|useSWR|router\.refresh/);
    assert.doesNotMatch(staffClient(), /fetch\(|useSWR|router\.refresh/);
    assert.doesNotMatch(recent(), /fetch\(/);
    assert.doesNotMatch(adminClient(), /\/api\/reports/);
    assert.doesNotMatch(staffClient(), /\/api\/reports/);
  });

  it("uses compact KPI mode and 2-column mobile grid", () => {
    assert.match(widgets(), /compact\?: boolean/);
    assert.match(adminClient(), /compact/);
    assert.match(staffClient(), /compact/);
    assert.match(adminClient(), /grid grid-cols-2 gap-3 lg:grid-cols-4/);
    assert.match(staffClient(), /grid grid-cols-2 gap-3/);
    assert.doesNotMatch(adminClient(), /grid gap-4 sm:grid-cols-2/);
    assert.match(adminClient(), /data-reports-kpi-grid/);
  });

  it("keeps Dashboard KpiCard default padding when compact is omitted", () => {
    assert.match(widgets(), /compact \? "p-3\.5 sm:p-4" : "p-5"/);
    const dash = read("src/components/dashboard/admin-dashboard-client.tsx");
    assert.doesNotMatch(dash, /compact/);
    const staffDash = read(
      "src/components/dashboard/staff-dashboard-client.tsx",
    );
    assert.doesNotMatch(staffDash, /compact/);
  });

  it("renders mobile cards and desktop table without min-w-640 table on mobile", () => {
    const source = recent();
    assert.match(source, /data-reports-recent-mobile/);
    assert.match(source, /data-reports-recent-desktop/);
    assert.match(source, /lg:hidden/);
    assert.match(source, /hidden overflow-x-auto lg:block/);
    assert.doesNotMatch(source, /min-w-\[640px\]/);
    assert.match(source, /whitespace-nowrap/);
    assert.match(source, /href=\{`\/customers\/\$\{item\.customerId\}`\}/);
  });

  it("Admin shows staff name; Staff list does not add other-staff columns by default", () => {
    assert.match(adminClient(), /showStaffName/);
    assert.doesNotMatch(staffClient(), /showStaffName/);
    assert.match(recent(), /showStaffName &&/);
  });

  it("empty states: page banner + section empties; KPI still receive numeric values", () => {
    assert.match(adminClient(), /noReportDataTitle/);
    assert.match(adminClient(), /noReportDataDescription/);
    assert.match(adminClient(), /data-reports-empty-banner/);
    assert.match(adminClient(), /reports\.noStageData/);
    assert.match(adminClient(), /reports\.noStaffDistribution/);
    assert.match(recent(), /reports\.noRecentFollowUps/);
    assert.doesNotMatch(adminClient(), /reports\.noData/);
    assert.match(adminClient(), /value=\{stats\.totalCustomers\}/);
  });

  it("scope notes match current SQL semantics and mention public pool for Admin", () => {
    assert.match(adminClient(), /scopeNoteAdmin/);
    assert.match(staffClient(), /scopeNoteStaff/);
    assert.match(adminClient(), /data-reports-scope-note/);
    const zhHant = read("src/i18n/locales/zh-Hant.ts");
    const zhHans = read("src/i18n/locales/zh-Hans.ts");
    const en = read("src/i18n/locales/en.ts");
    for (const locale of [zhHant, zhHans, en]) {
      assert.match(locale, /scopeNoteAdmin:/);
      assert.match(locale, /scopeNoteStaff:/);
      assert.match(locale, /noReportDataTitle:/);
      assert.match(locale, /noReportDataDescription:/);
    }
    const staffNoteHant = zhHant.match(/scopeNoteStaff:\s*"([^"]+)"/)?.[1] ?? "";
    const staffNoteHans = zhHans.match(/scopeNoteStaff:\s*"([^"]+)"/)?.[1] ?? "";
    const staffNoteEn = en.match(/scopeNoteStaff:\s*"([^"]+)"/)?.[1] ?? "";
    assert.match(zhHant, /scopeNoteAdmin:[\s\S]*?公共池/);
    assert.match(zhHans, /scopeNoteAdmin:[\s\S]*?公共池/);
    assert.match(en, /scopeNoteAdmin:[\s\S]*?public pool/i);
    assert.match(staffNoteHant, /階段分佈|建立記錄/);
    assert.match(staffNoteHans, /阶段分布|创建记录/);
    assert.match(staffNoteEn, /stage distribution|created the record/i);
    assert.doesNotMatch(staffNoteHant, /共同負責|assignee|Dashboard|儀表板/i);
    assert.doesNotMatch(staffNoteHans, /共同负责|assignee|Dashboard|仪表盘/i);
    assert.doesNotMatch(staffNoteEn, /assignee|co-owner|dashboard/i);
    assert.doesNotMatch(staffNoteHant, /createdBy|ownerId/);
    assert.doesNotMatch(staffNoteHans, /createdBy|ownerId/);
    assert.doesNotMatch(staffNoteEn, /createdBy|ownerId/);
  });

  it("PageIntro compact reduces title area; RankingTable requires emptyMessage", () => {
    assert.match(pageIntro(), /compact\?: boolean/);
    assert.match(adminClient(), /PageIntro[\s\S]*compact/);
    assert.match(widgets(), /emptyMessage: string/);
    assert.doesNotMatch(widgets(), /暂无数据/);
  });

  it("does not add chart dependency, date filters, or package.json changes", () => {
    const pkg = read("package.json");
    assert.doesNotMatch(pkg, /recharts|chart\.js|victory|nivo/i);
    assert.doesNotMatch(adminClient(), /DatePicker|date-range|customRange/);
    assert.doesNotMatch(adminClient(), /pushState|searchParams|returnTo/);
    assert.doesNotMatch(adminClient(), /\.csv|xlsx|application\/pdf|window\.print/);
    assert.doesNotMatch(staffClient(), /\.csv|xlsx|application\/pdf|window\.print/);
  });
});
