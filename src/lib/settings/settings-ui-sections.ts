import { isLockedSettingKey, type SettingKey } from "@/lib/settings/keys";

export const COLLABORATIVE_DISSOLUTION_FLAG_KEY =
  "collaborative_dissolution_enabled" as const satisfies SettingKey;

/** Settings shown as read-only badges or disabled inputs — never in PATCH payload. */
export const READONLY_DISPLAY_SETTING_KEYS = [
  "inactivity_logout_minutes",
  COLLABORATIVE_DISSOLUTION_FLAG_KEY,
] as const satisfies readonly SettingKey[];

export type ReadonlyDisplaySettingKey =
  (typeof READONLY_DISPLAY_SETTING_KEYS)[number];

export type SettingsSectionId =
  | "basic"
  | "reclaimPublicPool"
  | "customerRules"
  | "collaborative"
  | "security";

export type SettingsLinkCardId =
  | "dryRun"
  | "ai"
  | "announcements"
  | "devices"
  | "securityPolicies";

export type SettingsLinkCard = {
  id: SettingsLinkCardId;
  href: string;
  titleKey: string;
  descriptionKey: string;
  buttonKey: string;
};

export type SettingsSection = {
  id: SettingsSectionId;
  titleKey: string;
  descriptionKey: string;
  editableKeys: readonly SettingKey[];
  readonlyKeys?: readonly ReadonlyDisplaySettingKey[];
  linkCards?: readonly SettingsLinkCardId[];
};

export const SETTINGS_UI_SECTIONS: readonly SettingsSection[] = [
  {
    id: "basic",
    titleKey: "settings.sections.basic.title",
    descriptionKey: "settings.sections.basic.description",
    editableKeys: ["business_timezone"],
  },
  {
    id: "reclaimPublicPool",
    titleKey: "settings.sections.reclaimPublicPool.title",
    descriptionKey: "settings.sections.reclaimPublicPool.description",
    editableKeys: [
      "automatic_reclaim_days",
      "reclaim_warning_days_before",
      "public_pool_claim_quota_7_days",
      "public_pool_claim_cooldown_hours",
    ],
  },
  {
    id: "customerRules",
    titleKey: "settings.sections.customerRules.title",
    descriptionKey: "settings.sections.customerRules.description",
    editableKeys: ["first_contact_sla_hours"],
  },
  {
    id: "collaborative",
    titleKey: "settings.sections.collaborative.title",
    descriptionKey: "settings.sections.collaborative.description",
    editableKeys: [],
    readonlyKeys: [COLLABORATIVE_DISSOLUTION_FLAG_KEY],
    linkCards: ["dryRun"],
  },
  {
    id: "security",
    titleKey: "settings.sections.security.title",
    descriptionKey: "settings.sections.security.description",
    editableKeys: [
      "device_authorization_enabled",
      "device_authorization_limit_per_user",
    ],
    readonlyKeys: ["inactivity_logout_minutes"],
    linkCards: ["devices", "securityPolicies"],
  },
] as const;

export const SETTINGS_LINK_CARDS: Record<SettingsLinkCardId, SettingsLinkCard> =
  {
    dryRun: {
      id: "dryRun",
      href: "/admin/reclamation/collaborative-dry-run",
      titleKey: "settings.cards.dryRun.title",
      descriptionKey: "settings.cards.dryRun.description",
      buttonKey: "settings.cards.dryRun.button",
    },
    ai: {
      id: "ai",
      href: "/admin/ai-settings",
      titleKey: "settings.cards.ai.title",
      descriptionKey: "settings.cards.ai.description",
      buttonKey: "settings.cards.ai.button",
    },
    announcements: {
      id: "announcements",
      href: "/admin/announcements",
      titleKey: "settings.cards.announcements.title",
      descriptionKey: "settings.cards.announcements.description",
      buttonKey: "settings.cards.announcements.button",
    },
    devices: {
      id: "devices",
      href: "/admin/devices",
      titleKey: "settings.cards.devices.title",
      descriptionKey: "settings.cards.devices.description",
      buttonKey: "settings.cards.devices.button",
    },
    securityPolicies: {
      id: "securityPolicies",
      href: "/admin/settings/security",
      titleKey: "settings.cards.securityPolicies.title",
      descriptionKey: "settings.cards.securityPolicies.description",
      buttonKey: "settings.cards.securityPolicies.button",
    },
  };

/** Standalone link-only sections rendered after editable sections. */
export const SETTINGS_LINK_ONLY_SECTIONS = [
  {
    id: "ai" as const,
    titleKey: "settings.sections.ai.title",
    descriptionKey: "settings.sections.ai.description",
    linkCards: ["ai"] as const,
  },
  {
    id: "announcements" as const,
    titleKey: "settings.sections.announcements.title",
    descriptionKey: "settings.sections.announcements.description",
    linkCards: ["announcements"] as const,
  },
] as const;

/** Action ids that must never appear on the settings page. */
export const FORBIDDEN_SETTINGS_ACTION_IDS = [
  "execute",
  "dissolve",
  "release",
  "enableCollaborativeDissolution",
] as const;

const EDITABLE_SETTING_KEY_SET = new Set<SettingKey>(
  SETTINGS_UI_SECTIONS.flatMap((section) => section.editableKeys),
);

export function getEditableSettingKeys(): SettingKey[] {
  return [...EDITABLE_SETTING_KEY_SET];
}

export function isEditableSettingKey(key: string): key is SettingKey {
  return EDITABLE_SETTING_KEY_SET.has(key as SettingKey);
}

export function isReadonlyDisplaySettingKey(
  key: string,
): key is ReadonlyDisplaySettingKey {
  return (READONLY_DISPLAY_SETTING_KEYS as readonly string[]).includes(key);
}

export function buildSettingsSavePayload(
  settings: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) =>
        isEditableSettingKey(key) && !isLockedSettingKey(key),
    ),
  );
}

export function getSectionKeys(sectionId: SettingsSectionId): SettingKey[] {
  const section = SETTINGS_UI_SECTIONS.find((item) => item.id === sectionId);
  if (!section) return [];
  return [
    ...section.editableKeys,
    ...(section.readonlyKeys ?? []),
  ];
}
