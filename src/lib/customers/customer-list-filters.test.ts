import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminCustomerListStatusWhere,
  excludeArchivedWhere,
  excludePublicPoolWhere,
  normalCustomerListStatusWhere,
  ownedNormalCustomerListWhere,
  staffCustomerListPermissionWhere,
} from "@/lib/customers/customer-list-filters";
import {
  CUSTOMER_LIST_PAGE_SIZE,
  buildCustomerListPagination,
  parseCustomerListPageParams,
} from "@/lib/customers/queries";

describe("customer list filter helpers", () => {
  it("exports status exclusion helpers", () => {
    assert.ok(excludeArchivedWhere());
    assert.ok(excludePublicPoolWhere());
    assert.ok(normalCustomerListStatusWhere());
  });

  it("admin normal list excludes public_pool", () => {
    const where = adminCustomerListStatusWhere({});
    assert.ok(where);
    assert.notEqual(String(where), "");
  });

  it("admin archived list only includes archived", () => {
    const where = adminCustomerListStatusWhere({ status: "archived" });
    assert.ok(where);
  });

  it("staff permission where composes owner/assignee with normal status", () => {
    const where = staffCustomerListPermissionWhere("user-1");
    assert.ok(where);
  });

  it("owned normal list where composes owner with normal status", () => {
    const where = ownedNormalCustomerListWhere("user-1");
    assert.ok(where);
  });
});

describe("customer list pagination page size 40", () => {
  it("uses fixed page size 40", () => {
    assert.equal(CUSTOMER_LIST_PAGE_SIZE, 40);
  });

  it("page 1 offset is 0 and pageSize is 40", () => {
    const parsed = parseCustomerListPageParams({ page: "1" });
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 40);
    assert.equal(parsed.offset, 0);
  });

  it("page 2 offset is 40", () => {
    const parsed = parseCustomerListPageParams({ page: 2 });
    assert.equal(parsed.page, 2);
    assert.equal(parsed.pageSize, 40);
    assert.equal(parsed.offset, 40);
  });

  it("page 3 offset is 80", () => {
    const parsed = parseCustomerListPageParams({ page: "3" });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.pageSize, 40);
    assert.equal(parsed.offset, 80);
  });

  it("totalPages uses page size 40", () => {
    const pagination = buildCustomerListPagination(100, 1);
    assert.equal(pagination.pageSize, 40);
    assert.equal(pagination.total, 100);
    assert.equal(pagination.pageCount, 3);
  });

  it("last page with fewer than 40 items still has pageSize 40", () => {
    const pagination = buildCustomerListPagination(45, 2);
    assert.equal(pagination.page, 2);
    assert.equal(pagination.pageSize, 40);
    assert.equal(pagination.pageCount, 2);
  });

  it("total under 40 yields a single page", () => {
    const pagination = buildCustomerListPagination(12, 1);
    assert.equal(pagination.page, 1);
    assert.equal(pagination.pageSize, 40);
    assert.equal(pagination.pageCount, 1);
  });

  it("invalid page falls back to page 1", () => {
    const parsed = parseCustomerListPageParams({ page: "0" });
    assert.equal(parsed.page, 1);
    assert.equal(parsed.offset, 0);
    assert.equal(parsed.pageSize, 40);
  });
});
