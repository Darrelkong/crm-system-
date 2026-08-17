import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY } from "@/lib/constants/customer-sources";
import {
  isQuickEntryCustomer,
  QUICK_ENTRY_ENTRY_METHOD,
} from "@/lib/public-pool/quick-entry-entry-method";

describe("isQuickEntryCustomer", () => {
  it("detects new Quick Entry via entry_method", () => {
    assert.equal(
      isQuickEntryCustomer({
        source: "xiaohongshu",
        entryMethod: QUICK_ENTRY_ENTRY_METHOD,
      }),
      true,
    );
  });

  it("detects legacy Quick Entry via source only", () => {
    assert.equal(
      isQuickEntryCustomer({
        source: PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY,
        entryMethod: null,
      }),
      true,
    );
  });

  it("rejects ordinary customers", () => {
    assert.equal(
      isQuickEntryCustomer({
        source: "xiaohongshu",
        entryMethod: null,
      }),
      false,
    );
  });
});
