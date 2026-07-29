import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function extractFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `missing export async function ${name}`);
  const brace = source.indexOf("{", start);
  assert.ok(brace >= 0);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(brace, i + 1);
    }
  }
  assert.fail(`unbalanced braces for ${name}`);
}

describe("reports Round B Staff metrics wiring", () => {
  const staffPath = "src/lib/reports/staff-reports.ts";
  const staffSource = () => read(staffPath);
  const staffBody = () =>
    extractFunctionBody(staffSource(), "getStaffReportsStats");

  it("keeps total customers as ownerId + active only", () => {
    const body = staffBody();
    assert.match(
      body,
      /ownedActiveFilter\s*=\s*and\(\s*eq\(schema\.customers\.ownerId, user\.id\),\s*eq\(schema\.customers\.status, "active"\),\s*\)/,
    );
    assert.match(body, /\.where\(ownedActiveFilter\)/);
    assert.match(body, /myCustomers:\s*myCustomersRow/);
  });

  it("attributes today/week/month new customers to createdBy with deletedAt IS NULL", () => {
    const source = staffSource();
    const body = staffBody();

    assert.match(source, /createdNewCustomerFilter/);
    assert.match(
      source,
      /eq\(schema\.customers\.createdBy, userId\)[\s\S]*?isNull\(schema\.customers\.deletedAt\)/,
    );

    // Today: keep lte(todayEnd); do not switch to lt.
    assert.match(
      body,
      /eq\(schema\.customers\.createdBy, user\.id\)[\s\S]*?isNull\(schema\.customers\.deletedAt\)[\s\S]*?gte\(schema\.customers\.createdAt, todayStart\)[\s\S]*?lte\(schema\.customers\.createdAt, todayEnd\)/,
    );
    assert.match(body, /createdNewCustomerFilter\(user\.id, weekStart, weekEndExclusive\)/);
    assert.match(
      body,
      /createdNewCustomerFilter\(user\.id, monthStart, monthEndExclusive\)/,
    );

    // Week/month helper still uses exclusive end via lt.
    assert.match(
      source,
      /createdNewCustomerFilter[\s\S]*?lt\(schema\.customers\.createdAt, endExclusive\)/,
    );
  });

  it("new-customer KPIs do not use ownerId, list-status helpers, or ownerId fallback", () => {
    const source = staffSource();
    assert.doesNotMatch(source, /ownedNormalCustomerListWhere/);
    assert.doesNotMatch(source, /normalCustomerListStatusWhere/);
    assert.doesNotMatch(
      source,
      /from ["']@\/lib\/customers\/customer-list-filters["']/,
    );

    // New KPI blocks must not filter by ownerId or status (pool/inactive stay in).
    const helper = source.match(
      /function createdNewCustomerFilter[\s\S]*?\n\}/,
    )?.[0];
    assert.ok(helper);
    assert.doesNotMatch(helper!, /ownerId/);
    assert.doesNotMatch(helper!, /status/);
    assert.doesNotMatch(helper!, /COALESCE|ownerId\s*\?\?|fallback/i);

    const todayBlock = source.match(
      /newTodayRow[\s\S]*?\.where\(\s*and\([\s\S]*?\)\s*,\s*\)/,
    )?.[0];
    assert.ok(todayBlock);
    assert.doesNotMatch(todayBlock!, /ownerId/);
    assert.doesNotMatch(todayBlock!, /status/);
  });

  it("stage distribution reuses ownedActiveFilter (same scope as total)", () => {
    const body = staffBody();
    const stageSection = body.match(
      /select\(\{[\s\S]*?label:\s*schema\.customers\.salesStage[\s\S]*?listRecentFollowUpsForStaff/,
    )?.[0];
    assert.ok(stageSection);
    assert.match(stageSection!, /\.where\(ownedActiveFilter\)/);
    assert.doesNotMatch(stageSection!, /ownedNormalCustomerListWhere/);
    assert.doesNotMatch(stageSection!, /ownedNonArchivedFilter/);
    assert.match(stageSection!, /groupBy\(schema\.customers\.salesStage\)/);
    assert.match(stageSection!, /orderBy\(desc\(count\(\)\)\)/);
  });

  it("does not change follow-up KPIs, recent follow-ups, or date helpers", () => {
    const source = staffSource();
    const body = staffBody();
    assert.match(source, /function staffFollowUpFilter/);
    assert.match(
      source,
      /eq\(schema\.followUps\.userId, userId\)[\s\S]*?gte\(schema\.followUps\.followUpTime/,
    );
    assert.match(
      body,
      /eq\(schema\.followUps\.userId, user\.id\)[\s\S]*?lte\(schema\.followUps\.followUpTime, todayEnd\)/,
    );
    assert.match(body, /staffFollowUpFilter\(user\.id, weekStart, weekEndExclusive\)/);
    assert.match(
      body,
      /staffFollowUpFilter\(user\.id, monthStart, monthEndExclusive\)/,
    );
    assert.match(body, /listRecentFollowUpsForStaff\(db, user\.id\)/);
    assert.match(source, /getBusinessTodayRange/);
    assert.match(source, /getBusinessWeekRange/);
    assert.match(source, /getBusinessMonthRange/);

    const dates = read("src/lib/reports/dates.ts");
    assert.match(dates, /BUSINESS_UTC_OFFSET_MS = 8 \* 60 \* 60 \* 1000/);
    const recent = read("src/lib/reports/recent-follow-ups.ts");
    assert.match(recent, /RECENT_FOLLOW_UP_LIMIT = 10/);
  });

  it("does not modify Admin Reports, Dashboard stats, or staff-dashboard API", () => {
    const admin = read("src/lib/reports/admin-reports.ts");
    assert.doesNotMatch(admin, /createdBy/);
    assert.match(admin, /ne\(schema\.customers\.status, "archived"\)/);

    const dash = read("src/lib/reports/staff-dashboard.ts");
    assert.match(
      dash,
      /eq\(schema\.customers\.ownerId, user\.id\)[\s\S]*?normalCustomerListStatusWhere\(\)/,
    );
    assert.doesNotMatch(dash, /createdBy/);

    const api = read("src/app/api/reports/staff-dashboard/route.ts");
    assert.match(api, /getStaffDashboardStats/);
    assert.doesNotMatch(api, /getStaffReportsStats/);
  });

  it("does not add migration, index, package deps, or client fetch", () => {
    const staffClient = read("src/components/reports/staff-reports-client.tsx");
    assert.doesNotMatch(staffClient, /fetch\(|useSWR|\/api\/reports/);
    assert.match(staffClient, /scopeNoteStaff/);
    assert.match(staffClient, /grid grid-cols-2 gap-3/);

    const pkg = read("package.json");
    assert.doesNotMatch(pkg, /recharts|chart\.js/i);

    // No new migration files beyond the formal baseline marker in tree checks:
    // Round B must not touch drizzle/migrations.
    const staff = staffSource();
    assert.doesNotMatch(staff, /CREATE INDEX|ALTER TABLE/i);
  });

  it("updates Staff scope notes in three locales without technical field names", () => {
    const zhHant = read("src/i18n/locales/zh-Hant.ts");
    const zhHans = read("src/i18n/locales/zh-Hans.ts");
    const en = read("src/i18n/locales/en.ts");

    const hant =
      zhHant.match(/scopeNoteStaff:\s*"([^"]+)"/)?.[1] ?? "";
    const hans =
      zhHans.match(/scopeNoteStaff:\s*"([^"]+)"/)?.[1] ?? "";
    const enNote = en.match(/scopeNoteStaff:\s*"([^"]+)"/)?.[1] ?? "";

    assert.match(hant, /客戶總數與階段分佈/);
    assert.match(hant, /建立記錄/);
    assert.match(hant, /轉移負責人/);
    assert.match(hant, /跟進/);

    assert.match(hans, /客户总数与阶段分布/);
    assert.match(hans, /创建记录/);
    assert.match(hans, /转移负责人/);
    assert.match(hans, /跟进/);

    assert.match(enNote, /stage distribution/i);
    assert.match(enNote, /created the record/i);
    assert.match(enNote, /ownership changes/i);
    assert.match(enNote, /Follow-up/i);

    for (const note of [hant, hans, enNote]) {
      assert.doesNotMatch(note, /createdBy|ownerId|deletedAt|assignee/i);
      assert.doesNotMatch(note, /Dashboard|dashboard|儀表板|仪表盘/);
    }

    // Admin scope unchanged.
    assert.match(
      zhHant,
      /scopeNoteAdmin:\s*"客戶總數與階段分佈不含已歸檔客戶；客戶總數目前包含公共池/,
    );
    assert.match(
      zhHans,
      /scopeNoteAdmin:\s*"客户总数与阶段分布不含已归档客户；客户总数目前包含公共池/,
    );
    assert.match(
      en,
      /scopeNoteAdmin:\s*"Customer totals and stage breakdown exclude archived clients; totals currently include the public pool/,
    );

    for (const locale of [zhHant, zhHans, en]) {
      assert.match(locale, /scopeNoteStaff:/);
      assert.match(locale, /scopeNoteAdmin:/);
    }
  });
});
