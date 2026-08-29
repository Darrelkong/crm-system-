import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import { translate } from "@/i18n/translate";
import { SENDER_IDENTITY_GRANT_I18N_KEYS } from "@/lib/mail/client/sender-identity-grant-management";

const localeSources = [
  { locale: "en", messages: en },
  { locale: "zh-Hans", messages: zhHans },
  { locale: "zh-Hant", messages: zhHant },
] as const;

const UI_SOURCES = [
  "src/components/mail/admin/sender-identity-management.tsx",
  "src/components/mail/admin/sender-identity-grant-panel.tsx",
] as const;

function extractTranslationKeys(source: string): string[] {
  const keys = new Set<string>();
  const pattern =
    /t\(\s*(["'])(mail\.adminCenter\.[^"']+)\1/g;
  for (const match of source.matchAll(pattern)) {
    keys.add(match[2]!);
  }
  return [...keys];
}

describe("sender identity grant i18n", () => {
  for (const { locale, messages } of localeSources) {
    it(`resolves all grant management keys for ${locale}`, () => {
      for (const key of SENDER_IDENTITY_GRANT_I18N_KEYS) {
        const resolved = translate(messages, key, { count: "1", name: "Test", owner: "Owner" });
        assert.notEqual(resolved, key, `missing ${locale} key: ${key}`);
        assert.doesNotMatch(resolved, /^mail\.adminCenter\./);
        assert.doesNotMatch(resolved, /^MAIL\.ADMINCENTER\./i);
      }
    });
  }

  it("does not render raw mail.adminCenter keys from sender identity UI sources", () => {
    for (const path of UI_SOURCES) {
      const source = readFileSync(path, "utf8");
      const keys = extractTranslationKeys(source);
      assert.ok(keys.length > 0, `expected translation keys in ${path}`);
      for (const key of keys) {
        for (const { locale, messages } of localeSources) {
          const resolved = translate(messages, key, {
            count: "2",
            name: "DarrellKoo",
            owner: "Daniel.Hayes",
          });
          assert.notEqual(
            resolved,
            key,
            `${locale} missing UI key ${key} from ${path}`,
          );
          assert.doesNotMatch(
            resolved,
            /^mail\.adminCenter\./,
            `${locale} unresolved fragment in ${key}`,
          );
        }
      }
    }
  });

  it("keeps public locale JSON synchronized with TypeScript catalogs", () => {
    const json = JSON.parse(readFileSync("public/locales/zh-Hant.json", "utf8"));
    assert.deepEqual(json, zhHant);
  });
});

describe("sender identity grant layout wiring", () => {
  it("uses card rows instead of fragile multi-column tables", () => {
    const managementSource = readFileSync(
      "src/components/mail/admin/sender-identity-management.tsx",
      "utf8",
    );
    const panelSource = readFileSync(
      "src/components/mail/admin/sender-identity-grant-panel.tsx",
      "utf8",
    );

    assert.doesNotMatch(managementSource, /DataTable/);
    assert.doesNotMatch(managementSource, /TableShell/);
    assert.match(managementSource, /SenderIdentityCard/);
    assert.match(managementSource, /MAIL_ADMIN_TRUNCATE_EMAIL_CLASS/);
    assert.match(managementSource, /navigateToSection\("mailbox"\)/);

    assert.doesNotMatch(panelSource, /DataTable/);
    assert.doesNotMatch(panelSource, /TableShell/);
    assert.match(panelSource, /GrantUserCard/);
    assert.match(panelSource, /MAIL_ADMIN_TRUNCATE_EMAIL_CLASS/);
  });
});
