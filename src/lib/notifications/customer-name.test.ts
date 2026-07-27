import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customerNameNotificationParams,
  getCustomerNotificationDisplayName,
} from "@/lib/notifications/customer-name";
import {
  resolveNotificationMessage,
} from "@/i18n/resolve-notification-content";
import { storeNotificationMessage } from "@/lib/notifications/i18n-storage";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

function tFor(
  locale: typeof en | typeof zhHans | typeof zhHant,
): (key: string, params?: Record<string, string>) => string {
  return (key, params = {}) => {
    const parts = key.split(".");
    let cur: unknown = locale;
    for (const part of parts) {
      if (!cur || typeof cur !== "object") return key;
      cur = (cur as Record<string, unknown>)[part];
    }
    if (typeof cur !== "string") return key;
    let out = cur;
    for (const [k, v] of Object.entries(params)) {
      out = out.replaceAll(`{{${k}}}`, v);
    }
    return out;
  };
}

describe("getCustomerNotificationDisplayName", () => {
  it("confirmed traditional: bare real name", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "張三",
        nameStatus: "confirmed",
        locale: "zh-Hant",
        pendingLabel: zhHant.customers.namePendingBadge,
      }),
      "張三",
    );
  });

  it("confirmed simplified: bare real name", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "张三",
        nameStatus: "confirmed",
        locale: "zh-Hans",
        pendingLabel: zhHans.customers.namePendingBadge,
      }),
      "张三",
    );
  });

  it("confirmed English: bare real name", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "Alice Chen",
        nameStatus: "confirmed",
        locale: "en",
        pendingLabel: en.customers.namePendingBadge,
      }),
      "Alice Chen",
    );
  });

  it("pending X先生 traditional", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "X先生",
        nameStatus: "pending",
        locale: "zh-Hant",
        pendingLabel: zhHant.customers.namePendingBadge,
      }),
      "X先生（姓名待確認）",
    );
  });

  it("pending X女士 traditional", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "X女士",
        nameStatus: "pending",
        locale: "zh-Hant",
        pendingLabel: zhHant.customers.namePendingBadge,
      }),
      "X女士（姓名待確認）",
    );
  });

  it("pending X先生 simplified", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "X先生",
        nameStatus: "pending",
        locale: "zh-Hans",
        pendingLabel: zhHans.customers.namePendingBadge,
      }),
      "X先生（姓名待确认）",
    );
  });

  it("pending X女士 simplified", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "X女士",
        nameStatus: "pending",
        locale: "zh-Hans",
        pendingLabel: zhHans.customers.namePendingBadge,
      }),
      "X女士（姓名待确认）",
    );
  });

  it("pending X先生 English", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "X先生",
        nameStatus: "pending",
        locale: "en",
        pendingLabel: en.customers.namePendingBadge,
      }),
      "Mr. X (Name pending confirmation)",
    );
  });

  it("pending X女士 English", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "X女士",
        nameStatus: "pending",
        locale: "en",
        pendingLabel: en.customers.namePendingBadge,
      }),
      "Ms. X (Name pending confirmation)",
    );
  });

  it("missing nameStatus keeps legacy bare name (even placeholders)", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "X先生",
        nameStatus: undefined,
        locale: "zh-Hant",
        pendingLabel: zhHant.customers.namePendingBadge,
      }),
      "X先生",
    );
  });

  it("invalid nameStatus keeps legacy bare name", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "X先生",
        nameStatus: "weird",
        locale: "en",
        pendingLabel: en.customers.namePendingBadge,
      }),
      "X先生",
    );
  });

  it("empty customerName does not yield undefined", () => {
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: "",
        nameStatus: "pending",
        locale: "zh-Hant",
        pendingLabel: zhHant.customers.namePendingBadge,
      }),
      "",
    );
    assert.equal(
      getCustomerNotificationDisplayName({
        customerName: null,
        nameStatus: "confirmed",
        locale: "en",
        pendingLabel: en.customers.namePendingBadge,
      }),
      "",
    );
  });
});

describe("customerNameNotificationParams", () => {
  it("maps pending and confirmed", () => {
    assert.deepEqual(
      customerNameNotificationParams({
        customerName: "X先生",
        nameStatus: "pending",
      }),
      { customerName: "X先生", nameStatus: "pending" },
    );
    assert.deepEqual(
      customerNameNotificationParams({
        customerName: "王小明",
        nameStatus: "confirmed",
      }),
      { customerName: "王小明", nameStatus: "confirmed" },
    );
    assert.deepEqual(
      customerNameNotificationParams({ customerName: "王小明" }),
      { customerName: "王小明", nameStatus: "confirmed" },
    );
  });
});

describe("resolveNotificationMessage pending display", () => {
  it("pending zh-Hant interpolates confirmed-style suffix", () => {
    const message = storeNotificationMessage(
      "notificationMessages.approvalPendingAdmin",
      {
        customerName: "X先生",
        nameStatus: "pending",
        approvalType: "transfer_customer",
      },
    );
    const text = resolveNotificationMessage(
      tFor(zhHant),
      { message },
      { locale: "zh-Hant" },
    );
    assert.match(text, /X先生（姓名待確認）/);
    assert.doesNotMatch(text, /nameStatus/);
    assert.doesNotMatch(text, /\[object Object\]/);
    assert.doesNotMatch(text, /undefined/);
  });

  it("pending English uses Mr. X and Name pending confirmation", () => {
    const message = storeNotificationMessage(
      "notificationMessages.customerTransferredToYou",
      { customerName: "X先生", nameStatus: "pending" },
    );
    const text = resolveNotificationMessage(tFor(en), { message }, { locale: "en" });
    assert.match(text, /Mr\. X \(Name pending confirmation\)/);
  });

  it("confirmed does not add suffix", () => {
    const message = storeNotificationMessage(
      "notificationMessages.closedWonApproved",
      { customerName: "王小明", nameStatus: "confirmed" },
    );
    const text = resolveNotificationMessage(
      tFor(zhHant),
      { message },
      { locale: "zh-Hant" },
    );
    assert.match(text, /王小明/);
    assert.doesNotMatch(text, /姓名待確認/);
  });

  it("legacy params without nameStatus keep raw name", () => {
    const message = storeNotificationMessage(
      "notificationMessages.customerAutoReclaimed",
      { customerName: "X先生", days: "7" },
    );
    const text = resolveNotificationMessage(
      tFor(zhHant),
      { message },
      { locale: "zh-Hant" },
    );
    assert.match(text, /「X先生」/);
    assert.doesNotMatch(text, /姓名待確認/);
  });
});
