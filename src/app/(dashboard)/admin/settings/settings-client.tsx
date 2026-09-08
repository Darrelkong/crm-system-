"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import {
  COLLABORATIVE_DISSOLUTION_FLAG_KEY,
  buildSettingsSavePayload,
  SETTINGS_LINK_CARDS,
  SETTINGS_LINK_ONLY_SECTIONS,
  SETTINGS_UI_SECTIONS,
  type SettingsLinkCard,
  type SettingsSection,
} from "@/lib/settings/settings-ui-sections";
import { SETTING_LABELS, type SettingKey } from "@/lib/settings/keys";
import { SecondaryIdleCodeCard } from "./secondary-idle-code-card";
import { GlobalIdleExemptionSetting } from "./global-idle-exemption-setting";
import { PublicPoolQuickEntrySettingsCard } from "./public-pool-quick-entry-settings-card";

const BOOLEAN_SETTING_KEYS: readonly SettingKey[] = ["device_authorization_enabled"];

function isBooleanSettingKey(key: string): boolean {
  return (BOOLEAN_SETTING_KEYS as readonly string[]).includes(key);
}

function isSettingEnabled(value: string | undefined): boolean {
  return value === "true";
}

function CollaborationReminderPolicyCard({
  t,
}: {
  t: (key: string) => string;
}) {
  return (
    <section className="mt-5 rounded-xl border border-[#DCE7F5] bg-[#F8FBFF] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-[#172033]">
            {t("settings.collaborationReminder.title")}
          </h4>
          <p className="mt-1 text-xs text-[#6B7890]">
            {t("settings.collaborationReminder.statusLabel")}
          </p>
        </div>
        <Badge variant="success">
          {t("settings.collaborationReminder.statusEnabled")}
        </Badge>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[#6B7890]">
            {t("settings.collaborationReminder.intervalLabel")}
          </dt>
          <dd className="mt-1 font-semibold text-[#172033]">
            {t("settings.collaborationReminder.interval")}
          </dd>
        </div>
      </dl>
      <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-[#516078]">
        {t("settings.collaborationReminder.description")}
      </p>
    </section>
  );
}

function DeviceAuthorizationToggle({
  id,
  enabled,
  enabledLabel,
  disabledLabel,
  onChange,
}: {
  id: string;
  enabled: boolean;
  enabledLabel: string;
  disabledLabel: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="mt-1">
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
          enabled ? "bg-[#2563EB]" : "bg-[#CBD5E1] dark:bg-[#3A4459]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
      <p className="mt-1 text-xs text-[#6B7890]">
        {enabled ? enabledLabel : disabledLabel}
      </p>
    </div>
  );
}

function SettingsLinkCardView({
  card,
  t,
}: {
  card: SettingsLinkCard;
  t: (key: string) => string;
}) {
  return (
    <div className="rounded-xl border border-[#EEF3F8] bg-[#FAFBFD] p-4">
      <p className="text-sm font-semibold text-[#172033]">{t(card.titleKey)}</p>
      <p className="mt-2 text-sm leading-relaxed text-[#6B7890]">
        {t(card.descriptionKey)}
      </p>
      <Link
        href={card.href}
        className="secondary-button mt-4 inline-flex min-h-9 items-center rounded-xl px-3 py-1.5 text-sm font-medium"
      >
        {t(card.buttonKey)}
      </Link>
    </div>
  );
}

function SettingsSectionCard({
  section,
  settings,
  t,
  onChange,
}: {
  section: SettingsSection;
  settings: Record<string, string>;
  t: (key: string) => string;
  onChange: (key: SettingKey, value: string) => void;
}) {
  const fieldKeys = [
    ...section.editableKeys,
    ...(section.readonlyKeys ?? []),
  ];

  return (
    <section className="surface-card p-5 sm:p-6">
      <div className="max-w-3xl">
        <h3 className="text-base font-semibold text-[#172033]">
          {t(section.titleKey)}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-[#6B7890]">
          {t(section.descriptionKey)}
        </p>
      </div>

      {fieldKeys.length > 0 ? (
        <div className="mt-5 grid max-w-lg gap-4">
          {fieldKeys.map((key) => (
            <div key={key}>
              {key === COLLABORATIVE_DISSOLUTION_FLAG_KEY ? (
                <>
                  <Label>{SETTING_LABELS[key]}</Label>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        isSettingEnabled(settings[key]) ? "success" : "default"
                      }
                    >
                      {isSettingEnabled(settings[key])
                        ? t("settings.statusEnabled")
                        : t("settings.statusDisabled")}
                    </Badge>
                    <Badge variant="warning">{t("settings.badgeReadOnly")}</Badge>
                  </div>
                </>
              ) : (
                <>
                  <Label htmlFor={key}>{SETTING_LABELS[key]}</Label>
                  {isBooleanSettingKey(key) ? (
                    <DeviceAuthorizationToggle
                      id={key}
                      enabled={isSettingEnabled(settings[key])}
                      enabledLabel={t("settings.deviceAuthEnabledOn")}
                      disabledLabel={t("settings.deviceAuthEnabledOff")}
                      onChange={(next) =>
                        onChange(key, next ? "true" : "false")
                      }
                    />
                  ) : key === "business_timezone" ? (
                    <Select
                      id={key}
                      className="mt-1"
                      value={settings[key] ?? ""}
                      onChange={(e) => onChange(key, e.target.value)}
                    >
                      <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
                      <option value="UTC">UTC</option>
                    </Select>
                  ) : (
                    <>
                      <Input
                        id={key}
                        type="number"
                        min={key === "inactivity_logout_minutes" ? 5 : 1}
                        max={key === "inactivity_logout_minutes" ? 1440 : undefined}
                        step="1"
                        className="mt-1"
                        value={settings[key] ?? ""}
                        onChange={(e) => onChange(key, e.target.value)}
                      />
                      {key === "inactivity_logout_minutes" ? (
                        <p className="mt-1 text-xs text-[#6B7890]">
                          {t("settings.inactivityLogoutHint")}
                        </p>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {section.id === "collaborative" ? (
        <CollaborationReminderPolicyCard t={t} />
      ) : null}

      {section.linkCards && section.linkCards.length > 0 ? (
        <div
          className={`grid gap-4 ${fieldKeys.length > 0 ? "mt-5" : "mt-5"} md:grid-cols-2`}
        >
          {section.linkCards.map((cardId) => (
            <SettingsLinkCardView
              key={cardId}
              card={SETTINGS_LINK_CARDS[cardId]}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsClient() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/settings");
    const data = (await res.json()) as { settings?: Record<string, string> };
    setSettings(data.settings ?? {});
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial settings fetch on mount
    void load();
  }, [load]);

  function updateSetting(key: SettingKey, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: buildSettingsSavePayload(settings) }),
    });
    const data = (await res.json()) as {
      settings?: Record<string, string>;
      error?: string;
    };
    if (!res.ok) {
      setMessage(data.error ?? t("settings.saveFailed"));
      setSaving(false);
      return;
    }
    setSettings(data.settings ?? {});
    setMessage(t("settings.saveSuccess"));
    setSaving(false);
  }

  if (loading) {
    return <p className="text-sm text-[#6B7890]">{t("settings.loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <PageIntro
        title={t("settings.title")}
        description={t("settings.pageDescription")}
      />

      {SETTINGS_UI_SECTIONS.map((section) => (
        <Fragment key={section.id}>
          {section.id === "basic" ? <SecondaryIdleCodeCard /> : null}
          {section.id === "reclaimPublicPool" ? (
            <>
              <PublicPoolQuickEntrySettingsCard />
              <section className="surface-card mt-5 p-5 sm:p-6">
                <h3 className="text-base font-semibold text-[#172033]">
                  新人公共池保护期
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#6B7890]">
                  团队成员自首次成功登录 CRM 起进入 45 天保护期。保护期内不可主动领取公共池客户，期满后自动开放。
                </p>
                <p className="mt-3 text-sm font-medium text-[#172033]">
                  45 天
                </p>
              </section>
            </>
          ) : null}
          {section.id === "security" ? <GlobalIdleExemptionSetting /> : null}
          <SettingsSectionCard
            section={section}
            settings={settings}
            t={t}
            onChange={updateSetting}
          />
        </Fragment>
      ))}

      {SETTINGS_LINK_ONLY_SECTIONS.map((section) => (
        <section key={section.id} className="surface-card p-5 sm:p-6">
          <div className="max-w-3xl">
            <h3 className="text-base font-semibold text-[#172033]">
              {t(section.titleKey)}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[#6B7890]">
              {t(section.descriptionKey)}
            </p>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {section.linkCards.map((cardId) => (
              <SettingsLinkCardView
                key={cardId}
                card={SETTINGS_LINK_CARDS[cardId]}
                t={t}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="surface-card p-5 sm:p-6">
        <Button onClick={save} disabled={saving}>
          {saving ? t("settings.saving") : t("settings.save")}
        </Button>
        {message ? (
          <p className="mt-2 text-sm text-[#6B7890]">{message}</p>
        ) : null}
      </div>
    </div>
  );
}
