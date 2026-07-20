import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  GLOBAL_IDLE_EXEMPTION_API_PATH,
  buildGlobalIdleExemptionPatchBody,
  parseGlobalIdleExemptionGetResponse,
  parseGlobalIdleExemptionPatchResponse,
  patchBodyExposesEpoch,
  planGlobalIdleExemptionSwitchClick,
  shouldDisableSwitchControls,
} from "./global-idle-exemption-ui";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

describe("parseGlobalIdleExemptionGetResponse", () => {
  it("parses enabled false", () => {
    assert.deepEqual(parseGlobalIdleExemptionGetResponse({ enabled: false }), {
      ok: true,
      enabled: false,
    });
  });

  it("parses enabled true", () => {
    assert.deepEqual(parseGlobalIdleExemptionGetResponse({ enabled: true }), {
      ok: true,
      enabled: true,
    });
  });

  it("rejects missing enabled and does not read epoch fields", () => {
    assert.deepEqual(
      parseGlobalIdleExemptionGetResponse({
        staff_access_reverify_after: "123",
        staffAccessReverifyAfter: 123,
      }),
      { ok: false, error: "invalid_response" },
    );
    const withExtra = parseGlobalIdleExemptionGetResponse({
      enabled: true,
      staff_access_reverify_after: "999",
    });
    assert.deepEqual(withExtra, { ok: true, enabled: true });
    assert.ok(!JSON.stringify(withExtra).includes("staff_access_reverify"));
  });
});

describe("buildGlobalIdleExemptionPatchBody", () => {
  it("builds enable payload without epoch keys", () => {
    const body = buildGlobalIdleExemptionPatchBody(true);
    assert.deepEqual(body, { enabled: true });
    assert.equal(patchBodyExposesEpoch(body), false);
  });

  it("builds disable payload without epoch keys", () => {
    const body = buildGlobalIdleExemptionPatchBody(false);
    assert.deepEqual(body, { enabled: false });
    assert.equal(patchBodyExposesEpoch(body), false);
  });
});

describe("planGlobalIdleExemptionSwitchClick", () => {
  it("false → true enables immediately without confirm", () => {
    assert.deepEqual(planGlobalIdleExemptionSwitchClick(false, true), {
      action: "enable_immediately",
      enabled: true,
    });
  });

  it("true → false opens disable confirm", () => {
    assert.deepEqual(planGlobalIdleExemptionSwitchClick(true, false), {
      action: "open_disable_confirm",
    });
  });

  it("same-value is noop (no unnecessary request)", () => {
    assert.deepEqual(planGlobalIdleExemptionSwitchClick(true, true), {
      action: "noop",
    });
    assert.deepEqual(planGlobalIdleExemptionSwitchClick(false, false), {
      action: "noop",
    });
  });
});

describe("parseGlobalIdleExemptionPatchResponse", () => {
  it("success returns enabled", () => {
    assert.deepEqual(
      parseGlobalIdleExemptionPatchResponse(
        { enabled: true, changed: true },
        true,
      ),
      { ok: true, enabled: true, changed: true },
    );
  });

  it("http failure is request_failed", () => {
    assert.deepEqual(
      parseGlobalIdleExemptionPatchResponse({ error: "x" }, false),
      { ok: false, error: "request_failed" },
    );
  });
});

describe("shouldDisableSwitchControls", () => {
  it("disables while loading, saving, or load error", () => {
    assert.equal(
      shouldDisableSwitchControls({
        loading: true,
        saving: false,
        loadError: false,
      }),
      true,
    );
    assert.equal(
      shouldDisableSwitchControls({
        loading: false,
        saving: true,
        loadError: false,
      }),
      true,
    );
    assert.equal(
      shouldDisableSwitchControls({
        loading: false,
        saving: false,
        loadError: true,
      }),
      true,
    );
    assert.equal(
      shouldDisableSwitchControls({
        loading: false,
        saving: false,
        loadError: false,
      }),
      false,
    );
  });
});

describe("global idle exemption API path", () => {
  it("uses dedicated admin API, not ordinary settings PATCH", () => {
    assert.equal(
      GLOBAL_IDLE_EXEMPTION_API_PATH,
      "/api/admin/settings/global-idle-exemption",
    );
    assert.notEqual(GLOBAL_IDLE_EXEMPTION_API_PATH, "/api/admin/settings");
  });
});

describe("global idle exemption settings UI wiring", () => {
  const settingsClientSrc = readFileSync(
    new URL(
      "../../app/(dashboard)/admin/settings/settings-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const componentSrc = readFileSync(
    new URL(
      "../../app/(dashboard)/admin/settings/global-idle-exemption-setting.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  it("renders GlobalIdleExemptionSetting only on Admin settings security section", () => {
    assert.match(settingsClientSrc, /GlobalIdleExemptionSetting/);
    assert.match(settingsClientSrc, /section\.id === "security"/);
  });

  it("component uses dedicated GET/PATCH path and role=switch", () => {
    assert.match(componentSrc, /GLOBAL_IDLE_EXEMPTION_API_PATH/);
    assert.match(componentSrc, /role="switch"/);
    assert.match(componentSrc, /aria-checked/);
    assert.match(componentSrc, /role="dialog"/);
    assert.ok(!componentSrc.includes("/api/admin/settings\""));
    assert.ok(!componentSrc.includes("staff_access_reverify"));
    assert.ok(!componentSrc.includes("staffAccessReverifyAfter"));
  });

  it("does not log out Admin on disable success", () => {
    assert.ok(!componentSrc.includes("redirectToAccess"));
    assert.ok(!componentSrc.includes("/api/auth/logout"));
    assert.ok(!componentSrc.includes("performSecurityLogout"));
  });

  it("keeps Secondary Idle Code card in settings client", () => {
    assert.match(settingsClientSrc, /SecondaryIdleCodeCard/);
  });
});

describe("global idle exemption i18n keys", () => {
  const requiredKeys = [
    "title",
    "description",
    "statusOn",
    "statusOff",
    "loading",
    "enableSuccess",
    "disableSuccess",
    "saveFailed",
    "loadFailed",
    "saving",
    "confirmTitle",
    "confirmDescription",
    "confirmSubmit",
    "confirmCancel",
  ] as const;

  it("English keys are complete", () => {
    for (const key of requiredKeys) {
      assert.equal(
        typeof en.settings.globalIdleExemption[key],
        "string",
        `missing en ${key}`,
      );
      assert.ok(en.settings.globalIdleExemption[key].length > 0);
    }
  });

  it("简体中文 keys are complete", () => {
    for (const key of requiredKeys) {
      assert.equal(
        typeof zhHans.settings.globalIdleExemption[key],
        "string",
        `missing zh-Hans ${key}`,
      );
    }
  });

  it("繁體中文 keys are complete", () => {
    for (const key of requiredKeys) {
      assert.equal(
        typeof zhHant.settings.globalIdleExemption[key],
        "string",
        `missing zh-Hant ${key}`,
      );
    }
  });

  it("does not collide with access reverify client copy keys", () => {
    assert.notEqual(
      zhHant.settings.globalIdleExemption.title,
      zhHant.security.accessReverifyRequired,
    );
    assert.ok(
      zhHant.settings.globalIdleExemption.disableSuccess.includes("Access"),
    );
  });
});
