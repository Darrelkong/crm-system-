import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSettingsSavePayload,
  COLLABORATIVE_DISSOLUTION_FLAG_KEY,
  FORBIDDEN_SETTINGS_ACTION_IDS,
  getEditableSettingKeys,
  getSectionKeys,
  isReadonlyDisplaySettingKey,
  SETTINGS_LINK_CARDS,
  SETTINGS_UI_SECTIONS,
} from "./settings-ui-sections";

describe("settings UI sections", () => {
  it("collaborative_dissolution_enabled is not in editable setting keys", () => {
    const editable = getEditableSettingKeys();
    assert.equal(
      editable.includes(COLLABORATIVE_DISSOLUTION_FLAG_KEY),
      false,
    );
  });

  it("dry-run card href points to collaborative dry-run page", () => {
    assert.equal(
      SETTINGS_LINK_CARDS.dryRun.href,
      "/admin/reclamation/collaborative-dry-run",
    );
  });

  it("AI card href points to ai-settings page", () => {
    assert.equal(SETTINGS_LINK_CARDS.ai.href, "/admin/ai-settings");
  });

  it("announcements card href points to announcements page", () => {
    assert.equal(
      SETTINGS_LINK_CARDS.announcements.href,
      "/admin/announcements",
    );
  });

  it("reclaim and public pool keys share the same section", () => {
    const keys = getSectionKeys("reclaimPublicPool");
    assert.deepEqual(keys, [
      "automatic_reclaim_days",
      "reclaim_warning_days_before",
      "public_pool_claim_quota_7_days",
      "public_pool_claim_cooldown_hours",
    ]);
  });

  it("device keys are in the security section", () => {
    const keys = getSectionKeys("security");
    assert.equal(keys.includes("device_authorization_enabled"), true);
    assert.equal(keys.includes("device_authorization_limit_per_user"), true);
    assert.equal(keys.includes("inactivity_logout_minutes"), true);
  });

  it("keeps global idle exemption out of ordinary settings section keys (dedicated API UI)", () => {
    const allSectionKeys = SETTINGS_UI_SECTIONS.flatMap((section) => [
      ...section.editableKeys,
      ...(section.readonlyKeys ?? []),
    ]);
    assert.equal(
      allSectionKeys.includes("global_idle_timeout_exempt_enabled"),
      false,
    );
    assert.equal(
      getEditableSettingKeys().includes("global_idle_timeout_exempt_enabled"),
      false,
    );
    const payload = buildSettingsSavePayload({
      global_idle_timeout_exempt_enabled: "true",
      device_authorization_enabled: "true",
    });
    assert.equal("global_idle_timeout_exempt_enabled" in payload, false);
    assert.equal(payload.device_authorization_enabled, "true");
  });

  it("does not define execute / dissolve / release / enable action ids", () => {
    assert.deepEqual(FORBIDDEN_SETTINGS_ACTION_IDS, [
      "execute",
      "dissolve",
      "release",
      "enableCollaborativeDissolution",
    ]);

    for (const card of Object.values(SETTINGS_LINK_CARDS)) {
      for (const forbidden of FORBIDDEN_SETTINGS_ACTION_IDS) {
        assert.equal(card.id.includes(forbidden), false);
        assert.equal(card.buttonKey.includes(forbidden), false);
      }
    }
  });

  it("marks locked and collaborative flag keys as readonly display", () => {
    assert.equal(isReadonlyDisplaySettingKey("inactivity_logout_minutes"), true);
    assert.equal(
      isReadonlyDisplaySettingKey(COLLABORATIVE_DISSOLUTION_FLAG_KEY),
      true,
    );
    assert.equal(isReadonlyDisplaySettingKey("business_timezone"), false);
  });

  it("save payload excludes collaborative_dissolution_enabled and locked keys", () => {
    const payload = buildSettingsSavePayload({
      business_timezone: "UTC",
      automatic_reclaim_days: "7",
      inactivity_logout_minutes: "30",
      [COLLABORATIVE_DISSOLUTION_FLAG_KEY]: "false",
      device_authorization_enabled: "true",
    });

    assert.equal(payload.inactivity_logout_minutes, undefined);
    assert.equal(payload[COLLABORATIVE_DISSOLUTION_FLAG_KEY], undefined);
    assert.equal(payload.business_timezone, "UTC");
    assert.equal(payload.device_authorization_enabled, "true");
  });

  it("covers every editable key exactly once across sections", () => {
    const fromSections = SETTINGS_UI_SECTIONS.flatMap(
      (section) => section.editableKeys,
    );
    assert.deepEqual(fromSections.sort(), getEditableSettingKeys().sort());
  });
});
