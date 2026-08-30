import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import { translate } from "@/i18n/translate";

const TEAM_OVERVIEW_KEYS = [
  "mail.adminCenter.notificationIdentity.teamOverview.searchLabel",
  "mail.adminCenter.notificationIdentity.teamOverview.searchPlaceholder",
  "mail.adminCenter.notificationIdentity.teamOverview.statusFilterLabel",
  "mail.adminCenter.notificationIdentity.teamOverview.statusAll",
  "mail.adminCenter.notificationIdentity.teamOverview.noMatches",
  "mail.adminCenter.notificationIdentity.teamOverview.manageAction",
  "mail.adminCenter.notificationIdentity.teamOverview.configureAction",
  "mail.adminCenter.notificationIdentity.teamOverview.mailEnabled",
  "mail.adminCenter.notificationIdentity.teamOverview.mailDisabled",
  "mail.adminCenter.notificationIdentity.teamOverview.currentEmailPrefix",
  "mail.adminCenter.notificationIdentity.teamOverview.pendingEmail",
  "mail.adminCenter.notificationIdentity.teamOverview.columns.member",
  "mail.adminCenter.notificationIdentity.teamOverview.columns.email",
  "mail.adminCenter.notificationIdentity.teamOverview.columns.status",
  "mail.adminCenter.notificationIdentity.teamOverview.columns.verifiedAt",
  "mail.adminCenter.notificationIdentity.teamOverview.columns.actions",
] as const;

const localeCatalogs = [
  { label: "zh-Hant", messages: zhHant },
  { label: "zh-Hans", messages: zhHans },
  { label: "English", messages: en },
] as const;

describe("notification identity team overview i18n", () => {
  for (const { label, messages } of localeCatalogs) {
    it(`resolves all teamOverview keys in ${label}`, () => {
      for (const key of TEAM_OVERVIEW_KEYS) {
        const resolved = translate(messages, key, { email: "notify@example.com" });
        assert.notEqual(resolved, key, `raw key leaked for ${key}`);
        assert.match(resolved, /\S/);
      }
    });
  }

  it("does not render raw teamOverview keys from runtime JSON", () => {
    for (const jsonPath of [
      "public/locales/zh-Hant.json",
      "public/locales/zh-Hans.json",
      "public/locales/en.json",
    ]) {
      const json = JSON.parse(readFileSync(jsonPath, "utf8"));
      for (const key of TEAM_OVERVIEW_KEYS) {
        const resolved = translate(json, key, { email: "notify@example.com" });
        assert.notEqual(resolved, key, `${jsonPath} missing ${key}`);
      }
    }
  });

  it("uses localized search placeholder and column labels in component", () => {
    const source = readFileSync(
      "src/components/mail/admin/notification-identity-team-overview.tsx",
      "utf8",
    );
    assert.match(
      source,
      /mail\.adminCenter\.notificationIdentity\.teamOverview\.searchPlaceholder/,
    );
    assert.match(
      source,
      /mail\.adminCenter\.notificationIdentity\.teamOverview\.columns\.member/,
    );
    assert.doesNotMatch(source, /columns\.account/);
  });
});

describe("notification identity team overview layout", () => {
  it("uses compact five-column desktop model without shared table horizontal scroll shell", () => {
    const source = readFileSync(
      "src/components/mail/admin/notification-identity-team-overview.tsx",
      "utf8",
    );
    const css = readFileSync("src/app/globals.css", "utf8");

    assert.match(source, /notification-identity-team-overview-table/);
    assert.match(source, /OverviewMemberCell/);
    assert.match(source, /OverviewPrimaryAction/);
    assert.doesNotMatch(source, /TableShell/);
    assert.doesNotMatch(source, /columns\.account/);
    assert.match(css, /\.notification-identity-team-overview-table[\s\S]*table-layout:\s*fixed/);
    assert.match(css, /notification-identity-team-overview-filters/);
  });

  it("merges display name, CRM account, and Mail state in member cell", () => {
    const source = readFileSync(
      "src/components/mail/admin/notification-identity-team-overview.tsx",
      "utf8",
    );
    assert.match(source, /row\.name/);
    assert.match(source, /row\.email/);
    assert.match(source, /mailEnabled/);
    assert.match(source, /mailDisabled/);
  });

  it("keeps mobile cards and hides desktop table below md breakpoint", () => {
    const source = readFileSync(
      "src/components/mail/admin/notification-identity-team-overview.tsx",
      "utf8",
    );
    assert.match(source, /OverviewMobileCard/);
    assert.match(source, /md:hidden/);
    assert.match(source, /hidden md:block/);
  });

  it("wraps long notification emails safely", () => {
    const source = readFileSync(
      "src/components/mail/admin/notification-identity-team-overview.tsx",
      "utf8",
    );
    assert.match(source, /break-words/);
    assert.match(source, /pendingEmail/);
    assert.match(source, /currentEmailPrefix/);
  });
});
