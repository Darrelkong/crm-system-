import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCustomerListHref } from "@/components/ui/pagination";
import {
  buildCustomersPagePath,
  CUSTOMER_LIST_ACTIVE_SORT_MODE,
  decodeCustomerListSortPreference,
  encodeCustomerListSortPreference,
  parseCustomerListSortParam,
  shouldStripCustomerListSortParam,
} from "./customer-list-sort";

describe("customer list sort preference", () => {
  const userA = "user-a";
  const userB = "user-b";

  it("always resolves customer list sort to default", () => {
    assert.equal(parseCustomerListSortParam(undefined), "default");
    assert.equal(parseCustomerListSortParam("reclaim_soonest"), "default");
    assert.equal(parseCustomerListSortParam("default"), "default");
    assert.equal(parseCustomerListSortParam("invalid"), "default");
    assert.equal(
      parseCustomerListSortParam("reclaim_soonest", { archived: true }),
      "default",
    );
    assert.equal(CUSTOMER_LIST_ACTIVE_SORT_MODE, "default");
  });

  it("scopes remembered preference decode to the authenticated viewer", () => {
    const encoded = encodeCustomerListSortPreference(userA, "reclaim_soonest");
    assert.equal(
      decodeCustomerListSortPreference(encoded, userA),
      "reclaim_soonest",
    );
    assert.equal(decodeCustomerListSortPreference(encoded, userB), null);
  });

  it("builds customer list URLs without legacy sort params", () => {
    assert.equal(
      buildCustomersPagePath({
        sort: "reclaim_soonest",
        createdBy: "creator-1",
        heat: "hot",
        page: "2",
      }),
      "/customers?createdBy=creator-1&heat=hot&page=2",
    );
    assert.equal(buildCustomersPagePath({ sort: "default" }), "/customers");
    assert.equal(
      buildCustomerListHref({ page: 2 }),
      "/customers?page=2",
    );
  });

  it("strips any explicit sort query param from legacy URLs", () => {
    assert.equal(shouldStripCustomerListSortParam(undefined), false);
    assert.equal(shouldStripCustomerListSortParam("default"), true);
    assert.equal(shouldStripCustomerListSortParam("reclaim_soonest"), true);
  });

  it("ignores old reclaim cookie when resolving list sort", () => {
    const encoded = encodeCustomerListSortPreference(userA, "reclaim_soonest");
    assert.equal(decodeCustomerListSortPreference(encoded, userA), "reclaim_soonest");
    assert.equal(parseCustomerListSortParam(undefined), "default");
  });
});
