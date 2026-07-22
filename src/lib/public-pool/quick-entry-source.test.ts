import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_SOURCE_KEYS,
  isCustomerSourceKey,
  isInternalCustomerSourceKey,
  PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY,
} from "@/lib/constants/customer-sources";
import { INTERNAL_CUSTOMER_SOURCE_LABELS } from "@/lib/constants/customer-source-labels";
import { resolveCustomerTagLabel } from "@/lib/customer-tags/queries";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

describe("public_pool_quick_entry source", () => {
  it("is internal and not a generic selectable source key", () => {
    assert.equal(PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY, "public_pool_quick_entry");
    assert.equal(
      isInternalCustomerSourceKey(PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY),
      true,
    );
    assert.equal(isCustomerSourceKey(PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY), false);
    assert.equal(
      (CUSTOMER_SOURCE_KEYS as readonly string[]).includes(
        PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY,
      ),
      false,
    );
  });

  it("has i18n labels in en / zh-Hans / zh-Hant", () => {
    assert.equal(
      en.customerSources.public_pool_quick_entry,
      "Public Pool Quick Entry",
    );
    assert.equal(
      zhHans.customerSources.public_pool_quick_entry,
      "公共池快速录入",
    );
    assert.equal(
      zhHant.customerSources.public_pool_quick_entry,
      "公共池快速錄入",
    );
  });

  it("resolveCustomerTagLabel does not fall back to raw key", () => {
    const label = resolveCustomerTagLabel(
      PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY,
      new Map(),
    );
    assert.equal(
      label,
      INTERNAL_CUSTOMER_SOURCE_LABELS[PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY],
    );
    assert.notEqual(label, PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY);
  });
});
