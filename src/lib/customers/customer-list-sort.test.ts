import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomersPagePath,
  decodeCustomerListSortPreference,
  encodeCustomerListSortPreference,
  parseCustomerListSortParam,
} from "./customer-list-sort";

describe("customer list sort preference", () => {
  const userA = "user-a";
  const userB = "user-b";

  it("defaults to default sort and allowlists reclaim_soonest", () => {
    assert.equal(parseCustomerListSortParam(undefined), "default");
    assert.equal(parseCustomerListSortParam("reclaim_soonest"), "reclaim_soonest");
    assert.equal(parseCustomerListSortParam("invalid"), "default");
  });

  it("forces default on archived lists even when reclaim is requested", () => {
    assert.equal(
      parseCustomerListSortParam("reclaim_soonest", { archived: true }),
      "default",
    );
  });

  it("scopes remembered preference to the authenticated viewer", () => {
    const encoded = encodeCustomerListSortPreference(userA, "reclaim_soonest");
    assert.equal(
      decodeCustomerListSortPreference(encoded, userA),
      "reclaim_soonest",
    );
    assert.equal(decodeCustomerListSortPreference(encoded, userB), null);
  });

  it("remembers switching back to default", () => {
    const encoded = encodeCustomerListSortPreference(userA, "default");
    assert.equal(decodeCustomerListSortPreference(encoded, userA), "default");
  });

  it("builds customer list URLs with sort and preserved filters", () => {
    assert.equal(
      buildCustomersPagePath({
        sort: "reclaim_soonest",
        createdBy: "creator-1",
        heat: "hot",
        page: "2",
      }),
      "/customers?sort=reclaim_soonest&createdBy=creator-1&heat=hot&page=2",
    );
    assert.equal(buildCustomersPagePath({ sort: "default" }), "/customers");
  });
});
