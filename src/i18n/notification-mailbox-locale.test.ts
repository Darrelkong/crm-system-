import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { translate } from "@/i18n/translate";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

describe("notification mailbox locale catalog", () => {
  it("resolves disable section keys in Traditional Chinese source catalog", () => {
    assert.equal(
      translate(zhHant, "mail.notificationMailbox.disableSectionTitle"),
      "停用通知郵箱",
    );
    assert.equal(
      translate(zhHant, "mail.notificationMailbox.disableSectionDescription"),
      "停用後將停止使用此通知郵箱，並同時暫停 Mail 存取權限。",
    );
    assert.notEqual(
      translate(zhHant, "mail.notificationMailbox.disableSectionTitle"),
      "mail.notificationMailbox.disableSectionTitle",
    );
  });

  it("resolves management title in Traditional Chinese source catalog", () => {
    assert.equal(
      translate(zhHant, "mail.notificationMailbox.managementTitle"),
      "通知郵箱管理",
    );
    assert.notEqual(
      translate(zhHant, "mail.notificationMailbox.managementTitle"),
      "mail.notificationMailbox.managementTitle",
    );
  });

  it("keeps disable section keys in generated zh-Hant JSON", () => {
    const json = JSON.parse(
      readFileSync("public/locales/zh-Hant.json", "utf8"),
    );
    assert.equal(
      translate(json, "mail.notificationMailbox.disableSectionTitle"),
      "停用通知郵箱",
    );
    assert.equal(
      translate(json, "mail.notificationMailbox.disableSectionDescription"),
      "停用後將停止使用此通知郵箱，並同時暫停 Mail 存取權限。",
    );
    assert.equal(
      translate(json, "mail.notificationMailbox.managementTitle"),
      "通知郵箱管理",
    );
  });

  it("resolves disable and management keys across supported locales", () => {
    for (const messages of [en, zhHans, zhHant]) {
      assert.notEqual(
        translate(messages, "mail.notificationMailbox.disableSectionTitle"),
        "mail.notificationMailbox.disableSectionTitle",
      );
      assert.notEqual(
        translate(messages, "mail.notificationMailbox.disableSectionDescription"),
        "mail.notificationMailbox.disableSectionDescription",
      );
      assert.notEqual(
        translate(messages, "mail.notificationMailbox.managementTitle"),
        "mail.notificationMailbox.managementTitle",
      );
    }
  });
});
