import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CUSTOMER_SOURCE_OTHER_KEY } from "./constants";
import { assertTagDeletable } from "./service";
import {
  ensureUniqueTagKey,
  slugifyTagKey,
  validateTagLabel,
} from "./key";

describe("customer tag key helpers", () => {
  it("slugifies labels into stable keys", () => {
    assert.equal(slugifyTagKey("  VIP Client  "), "vip_client");
  });

  it("ensures unique keys when collisions exist", () => {
    const existing = new Set(["vip_client"]);
    assert.equal(
      ensureUniqueTagKey("vip_client", existing),
      "vip_client_2",
    );
  });

  it("rejects empty tag labels", () => {
    assert.equal(validateTagLabel("   "), "CUSTOMER_TAG_LABEL_REQUIRED");
  });
});

describe("customer tag delete rules", () => {
  it("blocks deleting the system other tag", () => {
    assert.throws(
      () =>
        assertTagDeletable({
          id: "1",
          tagKey: CUSTOMER_SOURCE_OTHER_KEY,
          label: "其他",
          isSystem: true,
          isActive: true,
          sortOrder: 99,
        }),
      /系统标签不可删除/,
    );
  });

  it("allows deleting non-system tags", () => {
    assert.doesNotThrow(() =>
      assertTagDeletable({
        id: "2",
        tagKey: "referral",
        label: "转介绍",
        isSystem: false,
        isActive: true,
        sortOrder: 1,
      }),
    );
  });
});
