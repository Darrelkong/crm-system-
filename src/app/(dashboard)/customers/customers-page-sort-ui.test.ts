import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(
  "src/app/(dashboard)/customers/page.tsx",
  "utf8",
);
const clientSource = readFileSync(
  "src/app/(dashboard)/customers/customers-list-client.tsx",
  "utf8",
);

describe("customers page sort UI removal", () => {
  it("strips legacy sort query params via redirect", () => {
    assert.match(pageSource, /shouldStripCustomerListSortParam\(params\.sort\)/);
    assert.match(pageSource, /redirect\(/);
    assert.match(pageSource, /buildCustomersPagePath\(/);
  });

  it("always uses default sort for SSR list queries", () => {
    assert.match(pageSource, /CUSTOMER_LIST_ACTIVE_SORT_MODE/);
    assert.doesNotMatch(pageSource, /reclaim_soonest/);
    assert.doesNotMatch(pageSource, /deferInitialListLoad/);
    assert.doesNotMatch(pageSource, /rememberCustomerListSortPreference/);
  });

  it("does not render CustomerListSortControl in the client list", () => {
    assert.doesNotMatch(clientSource, /CustomerListSortControl/);
    assert.doesNotMatch(clientSource, /sortModeLabel/);
    assert.doesNotMatch(clientSource, /sortModeReclaimHelper/);
    assert.doesNotMatch(clientSource, /reclaim_soonest/);
  });
});
