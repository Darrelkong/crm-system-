import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_FOLLOW_UP_LIST_FILTERS,
  countActiveFollowUpListFilters,
} from "./list-filters";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("follow-ups compact filter toolbar", () => {
  const client = () =>
    read("src/components/follow-ups/follow-ups-list-client.tsx");

  it("desktop uses compact toolbar; mobile defaults to search + filter entry", () => {
    const source = client();
    assert.match(source, /data-follow-ups-desktop-toolbar/);
    assert.match(source, /data-follow-ups-mobile-toolbar/);
    assert.match(source, /md:hidden/);
    assert.match(source, /hidden[\s\S]*md:flex/);
    assert.match(source, /mobileFiltersOpen/);
    assert.match(source, /useState\(false\)/);
    assert.match(source, /data-follow-ups-mobile-panel/);
    assert.match(source, /filtersWithCount/);
  });

  it("mobile panel stays collapsed by default and is gated by mobileFiltersOpen", () => {
    const source = client();
    assert.match(
      source,
      /mobileFiltersOpen && \([\s\S]*data-follow-ups-mobile-panel/,
    );
    assert.doesNotMatch(
      source,
      /setMobileFiltersOpen\(true\)/,
    );
  });

  it("active filter count uses shared helper semantics", () => {
    const source = client();
    assert.match(source, /countActiveFollowUpListFilters/);
    assert.equal(
      countActiveFollowUpListFilters(DEFAULT_FOLLOW_UP_LIST_FILTERS),
      0,
    );
    assert.equal(
      countActiveFollowUpListFilters({
        ...DEFAULT_FOLLOW_UP_LIST_FILTERS,
        search: "a",
        channel: "phone",
      }),
      2,
    );
  });

  it("staff filter remains role-gated; admin wiring unchanged", () => {
    const source = client();
    assert.match(source, /showStaff \? \(/);
    assert.match(source, /role === "admin"/);
    assert.match(source, /follow-up-staff/);
  });

  it("preserves URL / debounce / composition / history behavior", () => {
    const source = client();
    const filters = read("src/lib/follow-ups/list-filters.ts");
    assert.match(source, /history\.pushState/);
    assert.match(source, /history\.replaceState/);
    assert.match(source, /popstate/);
    assert.match(source, /SEARCH_DEBOUNCE_MS = 300/);
    assert.match(source, /onCompositionStart/);
    assert.match(source, /onCompositionEnd/);
    assert.match(filters, /"q"/);
    assert.match(filters, /"from"/);
    assert.match(filters, /"to"/);
    assert.match(filters, /"channel"/);
    assert.match(filters, /"staff"/);
    assert.doesNotMatch(source, /fetch\(/);
    assert.doesNotMatch(source, /router\.(push|replace)/);
  });

  it("result summary includes limit; empty states unchanged", () => {
    const source = client();
    assert.match(source, /resultSummary/);
    assert.match(source, /data-follow-ups-result-summary/);
    assert.match(source, /emptyTitle/);
    assert.match(source, /emptyFilteredTitle/);
    assert.match(source, /showFilteredEmpty/);
    assert.match(source, /showNoDataEmpty/);
  });

  it("keeps compact responsive touch targets and safe-area panel padding", () => {
    const source = client();
    assert.match(source, /min-h-11/);
    assert.match(source, /safe-area-inset-bottom/);
    assert.match(source, /crm-text-secondary/);
  });

  it("i18n keys for compact filters exist in three locales", () => {
    for (const locale of ["zh-Hant", "zh-Hans", "en"] as const) {
      const source = read(`src/i18n/locales/${locale}.ts`);
      assert.match(source, /resultSummary:/);
      assert.match(source, /filters:/);
      assert.match(source, /filtersWithCount:/);
      assert.match(source, /dateRange:/);
      assert.match(source, /activeFilters:/);
    }
  });

  it("Staff\/Admin SQL and validation remain untouched", () => {
    const queries = read("src/lib/follow-ups/list-queries.ts");
    assert.match(queries, /where\(eq\(schema\.followUps\.userId, userId\)\)/);
    assert.doesNotMatch(queries, /ownerId/);
    const validation = read("src/lib/follow-ups/validation.ts");
    assert.match(validation, /MIN_SUMMARY_LENGTH = 5/);
    assert.match(validation, /MIN_NEXT_ACTION_LENGTH = 10/);
  });
});
