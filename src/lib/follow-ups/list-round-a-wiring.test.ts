import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("follow-ups list Round A wiring", () => {
  it("client seeds filters from URL helper and uses history API", () => {
    const source = read("src/components/follow-ups/follow-ups-list-client.tsx");
    assert.match(source, /parseFollowUpListFilters/);
    assert.match(source, /buildFollowUpListHref/);
    assert.match(source, /history\.pushState/);
    assert.match(source, /history\.replaceState/);
    assert.match(source, /popstate/);
    assert.match(source, /SEARCH_DEBOUNCE_MS = 300/);
    assert.match(source, /onCompositionStart/);
    assert.match(source, /onCompositionEnd/);
    assert.match(source, /clearAllFilters/);
    assert.match(source, /emptyFilteredTitle/);
    assert.match(source, /emptyTitle/);
    assert.match(source, /resultSummary|listLimitNotice/);
    assert.doesNotMatch(source, /localStorage/);
    assert.doesNotMatch(source, /sessionStorage/);
    assert.doesNotMatch(source, /fetch\(/);
    assert.doesNotMatch(source, /router\.(push|replace)/);
  });

  it("page parses searchParams once for initial filters only", () => {
    const page = read("src/app/(dashboard)/follow-ups/page.tsx");
    assert.match(page, /parseFollowUpListFilters/);
    assert.match(page, /initialFilters/);
    assert.match(page, /searchParams/);
  });

  it("Staff SQL still filters by follow_ups.userId only", () => {
    const source = read("src/lib/follow-ups/list-queries.ts");
    assert.match(source, /export const FOLLOW_UPS_LIST_LIMIT = 500/);
    assert.match(source, /where\(eq\(schema\.followUps\.userId, userId\)\)/);
    assert.match(source, /orderBy\(desc\(schema\.followUps\.followUpTime\)\)/);
    assert.doesNotMatch(source, /ownerId/);
    assert.doesNotMatch(source, /customer_assignees/);
    assert.doesNotMatch(source, /archived/);
    assert.doesNotMatch(source, /deletedAt/);
    assert.doesNotMatch(source, /customerCode/);
    assert.doesNotMatch(source, /phone/);
    assert.doesNotMatch(source, /email/);
  });

  it("Admin SQL remains unscoped beyond joins", () => {
    const source = read("src/lib/follow-ups/list-queries.ts");
    const adminFn = source.slice(
      source.indexOf("export async function listFollowUpsForAdmin"),
      source.indexOf("export async function listFollowUpsForStaff"),
    );
    assert.doesNotMatch(adminFn, /\.where\(/);
    assert.match(adminFn, /\.limit\(limit\)/);
  });

  it("list DTO fields stay without customerCode / contact", () => {
    const types = read("src/lib/follow-ups/types.ts");
    assert.doesNotMatch(types, /customerCode/);
    assert.doesNotMatch(types, /phone/);
    assert.doesNotMatch(types, /email/);
    assert.doesNotMatch(types, /wechat/);
  });

  it("customer link route unchanged", () => {
    const source = read("src/components/follow-ups/follow-ups-list-client.tsx");
    assert.match(source, /href=\{`\/customers\/\$\{item\.customerId\}`\}/);
  });

  it("validation / create rules files untouched by Round A scope markers", () => {
    const validation = read("src/lib/follow-ups/validation.ts");
    assert.match(validation, /MIN_SUMMARY_LENGTH = 5/);
    assert.match(validation, /MIN_NEXT_ACTION_LENGTH = 10/);
    assert.match(validation, /MIN_NEXT_FOLLOW_UP_LEAD_MINUTES = 45/);
  });

  it("i18n keys exist in all three locales", () => {
    for (const locale of ["zh-Hant", "zh-Hans", "en"] as const) {
      const source = read(`src/i18n/locales/${locale}.ts`);
      assert.match(source, /staffDescription:/);
      assert.match(source, /emptyTitle:/);
      assert.match(source, /emptyDescription:/);
      assert.match(source, /emptyFilteredTitle:/);
      assert.match(source, /emptyFilteredDescription:/);
      assert.match(source, /clearAllFilters:/);
      assert.match(source, /listLimitNotice:/);
      assert.match(source, /resultCount:/);
    }
    const zhHant = read("src/i18n/locales/zh-Hant.ts");
    assert.match(zhHant, /查看你建立的客戶跟進記錄/);
    assert.doesNotMatch(zhHant, /查看您負責客戶的跟進紀錄/);
  });

  it("filtered empty shows clear; no-data empty does not use clearAllFilters action path only for filtered", () => {
    const source = read("src/components/follow-ups/follow-ups-list-client.tsx");
    assert.match(source, /showNoDataEmpty/);
    assert.match(source, /showFilteredEmpty/);
    assert.match(
      source,
      /showFilteredEmpty \?[\s\S]*clearAllFilters[\s\S]*: \(/,
    );
  });
});
