import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCustomerListHref } from "@/components/ui/pagination";
import {
  buildCustomersPagePath,
  decodeCustomerListSortPreference,
  encodeCustomerListSortPreference,
  parseCustomerListSortParam,
  resolveCustomerListSortMode,
  shouldRedirectToRememberedSort,
} from "./customer-list-sort";

describe("customer list sort preference", () => {
  const userA = "user-a";
  const userB = "user-b";

  it("defaults to default sort and allowlists reclaim_soonest", () => {
    assert.equal(parseCustomerListSortParam(undefined), "default");
    assert.equal(parseCustomerListSortParam("reclaim_soonest"), "reclaim_soonest");
    assert.equal(parseCustomerListSortParam("invalid"), "default");
  });

  it("parses explicit sort=default", () => {
    assert.equal(parseCustomerListSortParam("default"), "default");
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
    assert.equal(
      buildCustomersPagePath({ sort: "default" }),
      "/customers?sort=default",
    );
  });
});

describe("customer list sort switch flow", () => {
  const userA = "user-a";

  it("generates explicit sort=default when switching from reclaim", () => {
    const href = buildCustomerListHref({ sort: "default", page: 1 });
    assert.match(href, /[?&]sort=default(?:&|$)/);
  });

  it("explicit default overrides remembered reclaim_soonest", () => {
    assert.equal(
      resolveCustomerListSortMode("default", "reclaim_soonest"),
      "default",
    );
    const cookie = encodeCustomerListSortPreference(userA, "default");
    assert.equal(decodeCustomerListSortPreference(cookie, userA), "default");
  });

  it("does not redirect to reclaim after default is remembered", () => {
    assert.equal(
      shouldRedirectToRememberedSort(undefined, "default", false),
      false,
    );
    assert.equal(
      shouldRedirectToRememberedSort(undefined, null, false),
      false,
    );
  });

  it("still redirects bare /customers when reclaim is remembered", () => {
    assert.equal(
      shouldRedirectToRememberedSort(undefined, "reclaim_soonest", false),
      true,
    );
  });

  it("userA cookie does not affect userB", () => {
    const encoded = encodeCustomerListSortPreference(userA, "reclaim_soonest");
    assert.equal(decodeCustomerListSortPreference(encoded, userA), "reclaim_soonest");
    assert.equal(decodeCustomerListSortPreference(encoded, "user-b"), null);
    assert.equal(
      resolveCustomerListSortMode(undefined, decodeCustomerListSortPreference(encoded, "user-b")),
      "default",
    );
  });
});
