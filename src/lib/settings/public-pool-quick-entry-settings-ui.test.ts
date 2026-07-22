import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ADMIN_QUICK_ENTRY_API_PATH,
  adminRequestBodyHasForbiddenKeys,
  adminResponseExposesSecrets,
  buildSetCodeBody,
  buildSetEnabledBody,
  mapAdminQuickEntryErrorCode,
  parseAdminQuickEntryState,
  planAdminQuickEntrySwitchClick,
  shouldDisableAdminQuickEntryControls,
  validateClientQuickEntryCodePair,
} from "./public-pool-quick-entry-settings-ui";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

describe("parseAdminQuickEntryState", () => {
  it("parses admin state without code/hash", () => {
    const parsed = parseAdminQuickEntryState({
      enabled: true,
      hasCode: true,
      codeUpdatedAt: "2026-07-01T00:00:00.000Z",
      updatedBy: { userId: "u1", name: "Admin" },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.state.enabled, true);
    assert.equal(parsed.state.hasCode, true);
    assert.ok(!("code" in parsed.state));
    assert.ok(!JSON.stringify(parsed.state).includes("hash"));
  });

  it("rejects invalid payloads", () => {
    assert.equal(parseAdminQuickEntryState(null).ok, false);
    assert.equal(parseAdminQuickEntryState({ enabled: true }).ok, false);
  });
});

describe("adminResponseExposesSecrets", () => {
  it("flags code/hash/grantVersion leakage", () => {
    assert.equal(adminResponseExposesSecrets({ enabled: true, code: "x" }), true);
    assert.equal(
      adminResponseExposesSecrets({ enabled: true, codeHash: "y" }),
      true,
    );
    assert.equal(
      adminResponseExposesSecrets({ enabled: true, grantVersion: 1 }),
      true,
    );
    assert.equal(
      adminResponseExposesSecrets({
        enabled: false,
        hasCode: false,
        codeUpdatedAt: null,
        updatedBy: null,
      }),
      false,
    );
  });
});

describe("build admin request bodies", () => {
  it("set_code body has only action/code/confirmCode", () => {
    const body = buildSetCodeBody("Abcd1234", "Abcd1234");
    assert.deepEqual(body, {
      action: "set_code",
      code: "Abcd1234",
      confirmCode: "Abcd1234",
    });
    assert.equal(
      adminRequestBodyHasForbiddenKeys(body as Record<string, unknown>),
      false,
    );
  });

  it("set_enabled body has only action/enabled", () => {
    const body = buildSetEnabledBody(true);
    assert.deepEqual(body, { action: "set_enabled", enabled: true });
    assert.equal(
      adminRequestBodyHasForbiddenKeys(body as Record<string, unknown>),
      false,
    );
  });
});

describe("validateClientQuickEntryCodePair", () => {
  it("accepts matching valid codes", () => {
    assert.deepEqual(
      validateClientQuickEntryCodePair("Abcd1234", "Abcd1234"),
      { ok: true },
    );
  });

  it("rejects mismatch, format, and empty", () => {
    assert.equal(
      validateClientQuickEntryCodePair("Abcd1234", "Abcd1235").ok,
      false,
    );
    assert.equal(
      validateClientQuickEntryCodePair("abcdefgh", "abcdefgh").ok,
      false,
    );
    assert.equal(validateClientQuickEntryCodePair("", "Abcd1234").ok, false);
    assert.equal(
      validateClientQuickEntryCodePair(" Abcd1234", " Abcd1234").ok,
      false,
    );
  });
});

describe("planAdminQuickEntrySwitchClick", () => {
  it("blocks enable without code", () => {
    assert.deepEqual(
      planAdminQuickEntrySwitchClick({
        currentEnabled: false,
        nextEnabled: true,
        hasCode: false,
      }),
      { action: "block_need_code" },
    );
  });

  it("enables immediately when code configured", () => {
    assert.deepEqual(
      planAdminQuickEntrySwitchClick({
        currentEnabled: false,
        nextEnabled: true,
        hasCode: true,
      }),
      { action: "enable_immediately" },
    );
  });

  it("opens disable confirm", () => {
    assert.deepEqual(
      planAdminQuickEntrySwitchClick({
        currentEnabled: true,
        nextEnabled: false,
        hasCode: true,
      }),
      { action: "open_disable_confirm" },
    );
  });
});

describe("mapAdminQuickEntryErrorCode", () => {
  it("maps known codes", () => {
    assert.equal(
      mapAdminQuickEntryErrorCode("QUICK_ENTRY_CODE_NOT_CONFIGURED"),
      "not_configured",
    );
    assert.equal(
      mapAdminQuickEntryErrorCode("QUICK_ENTRY_CODE_CONFIRMATION_MISMATCH"),
      "mismatch",
    );
  });
});

describe("shouldDisableAdminQuickEntryControls", () => {
  it("disables while loading/saving/error", () => {
    assert.equal(
      shouldDisableAdminQuickEntryControls({
        loading: true,
        saving: false,
        loadError: false,
      }),
      true,
    );
    assert.equal(
      shouldDisableAdminQuickEntryControls({
        loading: false,
        saving: false,
        loadError: false,
      }),
      false,
    );
  });
});

describe("admin quick entry API path and wiring", () => {
  const settingsClientSrc = readFileSync(
    new URL(
      "../../app/(dashboard)/admin/settings/settings-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const componentSrc = readFileSync(
    new URL(
      "../../app/(dashboard)/admin/settings/public-pool-quick-entry-settings-card.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  it("uses dedicated admin quick entry API", () => {
    assert.equal(
      ADMIN_QUICK_ENTRY_API_PATH,
      "/api/admin/public-pool-quick-entry",
    );
    assert.match(componentSrc, /ADMIN_QUICK_ENTRY_API_PATH/);
  });

  it("wires card under reclaimPublicPool section", () => {
    assert.match(settingsClientSrc, /PublicPoolQuickEntrySettingsCard/);
    assert.match(settingsClientSrc, /section\.id === "reclaimPublicPool"/);
  });

  it("does not display current code/hash/grantVersion", () => {
    assert.ok(!componentSrc.includes("codeHash"));
    assert.ok(!componentSrc.includes("grantVersion"));
    assert.ok(!componentSrc.includes("plaintext"));
    assert.ok(!componentSrc.includes("localStorage"));
    assert.ok(!componentSrc.includes("sessionStorage"));
    assert.ok(!componentSrc.includes("console.log"));
  });

  it("clears password inputs after success path helpers exist", () => {
    assert.match(componentSrc, /clearCodeInputs/);
    assert.match(componentSrc, /type="password"/);
  });
});

describe("admin quick entry i18n keys", () => {
  const requiredKeys = [
    "title",
    "description",
    "setCode",
    "resetCode",
    "codeRules",
    "needCodeBeforeEnable",
    "codeResetSuccess",
    "disableConfirmTitle",
    "disableConfirmDescription",
  ] as const;

  it("has keys in en / zh-Hant / zh-Hans", () => {
    for (const key of requiredKeys) {
      assert.equal(typeof en.settings.publicPoolQuickEntry[key], "string");
      assert.equal(typeof zhHant.settings.publicPoolQuickEntry[key], "string");
      assert.equal(typeof zhHans.settings.publicPoolQuickEntry[key], "string");
    }
  });
});
