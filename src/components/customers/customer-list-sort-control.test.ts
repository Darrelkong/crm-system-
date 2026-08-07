import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildCustomerListApiSearchParams,
  buildCustomerListBrowserPath,
} from "@/lib/customers/customer-list-fetch";

describe("customer list sort control UX", () => {
  const source = readFileSync(
    "src/components/customers/customer-list-sort-control.tsx",
    "utf8",
  );

  it("uses accessible segmented button semantics", () => {
    assert.match(source, /role="group"/);
    assert.match(source, /aria-pressed=\{selected\}/);
    assert.match(source, /aria-label=\{t\("customers\.sortModeLabel"\)\}/);
    assert.match(source, /focus-visible:ring/);
    assert.match(source, /min-h-11/);
    assert.match(source, /grid-cols-2/);
    assert.match(source, /type="button"/);
    assert.match(source, /onSortChange/);
    assert.doesNotMatch(source, /<Link/);
  });

  it("shows helper text only for reclaim_soonest", () => {
    assert.match(source, /sortMode === "reclaim_soonest"/);
    assert.match(source, /customers\.sortModeReclaimHelper/);
  });
});

describe("customer list client-side fetch", () => {
  const clientSource = readFileSync(
    "src/app/(dashboard)/customers/customers-list-client.tsx",
    "utf8",
  );

  it("fetches list data from API instead of full page navigation for sort changes", () => {
    assert.match(clientSource, /fetch\(`\/api\/customers\?/);
    assert.match(clientSource, /handleSortChange/);
    assert.match(clientSource, /replaceCustomerListBrowserPath/);
    assert.match(clientSource, /onSortChange=\{handleSortChange\}/);
    assert.doesNotMatch(clientSource, /buildSortHref/);
  });

  it("uses client pagination refresh when not searching", () => {
    assert.match(clientSource, /handleListPageChange/);
    assert.match(clientSource, /onPageChange=\{isSearchActive \? setSearchPage : handleListPageChange\}/);
  });

  it("builds API and browser URLs with explicit sort params", () => {
    const params = buildCustomerListApiSearchParams({
      page: 2,
      sort: "reclaim_soonest",
      showArchived: false,
      filterCreatedBy: "user-1",
    });
    assert.equal(params.get("sort"), "reclaim_soonest");
    assert.equal(params.get("page"), "2");
    assert.equal(params.get("createdBy"), "user-1");

    const path = buildCustomerListBrowserPath({
      page: 1,
      sort: "default",
      showArchived: false,
    });
    assert.equal(path, "/customers?sort=default");
  });
});
