import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_DETAIL_APPROVAL_REQUEST_TYPES,
  isDisabledMergeCustomersRequestType,
} from "./errors";

describe("merge_customers disabled helpers", () => {
  it("identifies merge_customers as disabled", () => {
    assert.equal(isDisabledMergeCustomersRequestType("merge_customers"), true);
    assert.equal(isDisabledMergeCustomersRequestType("delete_customer"), false);
  });

  it("excludes merge_customers from customer detail request types", () => {
    const types = CUSTOMER_DETAIL_APPROVAL_REQUEST_TYPES as readonly string[];
    assert.equal(types.includes("merge_customers"), false);
    assert.equal(types.includes("delete_customer"), true);
    assert.equal(types.includes("transfer_customer"), true);
  });
});
