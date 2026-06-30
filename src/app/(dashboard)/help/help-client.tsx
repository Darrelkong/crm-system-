"use client";

import { Badge } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import {
  INACTIVITY_LOGOUT_MINUTES,
  LOCKOUT_THRESHOLD,
} from "@/lib/auth/constants";
import {
  getHelpFaqForRole,
  getHelpSectionsForRole,
  type HelpSectionConfig,
} from "@/lib/help/sections";
import { RECYCLE_BIN_RETENTION_DAYS } from "@/lib/recycle-bin/constants";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import { useTranslation } from "@/i18n/provider";

const RECLAIM_DAYS = SETTING_DEFAULTS.automatic_reclaim_days;
const RECLAIM_WARNING_DAYS = SETTING_DEFAULTS.reclaim_warning_days_before;
const POOL_QUOTA = SETTING_DEFAULTS.public_pool_claim_quota_7_days;
const POOL_COOLDOWN_HOURS = SETTING_DEFAULTS.public_pool_claim_cooldown_hours;
const CREATE_CONFIRM_SECONDS = "5";

const HELP_I18N_PARAMS: Record<string, Record<string, string>> = {
  "help.sections.recycleBin.items.retention": {
    days: String(RECYCLE_BIN_RETENTION_DAYS),
  },
  "help.sections.recycleBinAdmin.items.adminRestore": {
    days: String(RECYCLE_BIN_RETENTION_DAYS),
  },
  "help.sections.recycleBinAdmin.items.autoPurge": {
    days: String(RECYCLE_BIN_RETENTION_DAYS),
  },
  "help.sections.sensitiveDataStaff.items.createConfirm": {
    seconds: CREATE_CONFIRM_SECONDS,
  },
  "help.sections.autoReclaimSettings.items.reclaimDays": {
    days: RECLAIM_DAYS,
  },
  "help.sections.autoReclaimSettings.items.warningDays": {
    days: RECLAIM_WARNING_DAYS,
    reclaimDays: RECLAIM_DAYS,
  },
  "help.sections.publicPoolStaff.items.quotaCooldown": {
    quota: POOL_QUOTA,
    hours: POOL_COOLDOWN_HOURS,
  },
  "help.sections.publicPoolAdmin.items.poolSettings": {
    quota: POOL_QUOTA,
    hours: POOL_COOLDOWN_HOURS,
  },
  "help.sections.loginSecurity.items.staffLockout": {
    count: String(LOCKOUT_THRESHOLD),
  },
  "help.sections.loginSecurity.items.inactivityLogout": {
    minutes: String(INACTIVITY_LOGOUT_MINUTES),
  },
  "help.faq.autoLogout.answer": {
    minutes: String(INACTIVITY_LOGOUT_MINUTES),
  },
  "help.faq.accountLocked.answer": {
    count: String(LOCKOUT_THRESHOLD),
  },
  "help.faq.deletedCustomer.answer": {
    days: String(RECYCLE_BIN_RETENTION_DAYS),
  },
  "help.faq.createConfirmWait.answer": {
    seconds: CREATE_CONFIRM_SECONDS,
  },
  "help.faq.cannotClaimPool.answer": {
    quota: POOL_QUOTA,
    hours: POOL_COOLDOWN_HOURS,
  },
  "help.faq.autoReclaim.answer": {
    reclaimDays: RECLAIM_DAYS,
    warningDays: RECLAIM_WARNING_DAYS,
  },
};

function HelpSectionCard({
  section,
  role,
  t,
}: {
  section: HelpSectionConfig;
  role: "admin" | "staff";
  t: (key: string, params?: Record<string, string>) => string;
}) {
  return (
    <section className="surface-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-[#172033]">
          {t(section.titleKey)}
        </h3>
        {section.audience === "admin" && role === "admin" && (
          <Badge variant="accent">{t("help.adminOnlyBadge")}</Badge>
        )}
        {section.audience === "staff" && role === "staff" && (
          <Badge variant="accent">{t("help.staffOnlyBadge")}</Badge>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[#6B7890]">
        {t(section.descriptionKey)}
      </p>
      <ul className="mt-4 space-y-3">
        {section.itemKeys.map((itemKey) => (
          <li
            key={itemKey}
            className="rounded-xl border border-[#EEF3F8] bg-[#FAFBFD] px-4 py-3 text-sm leading-relaxed text-[#172033]"
          >
            {t(itemKey, HELP_I18N_PARAMS[itemKey])}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HelpClient({ role }: { role: "admin" | "staff" }) {
  const { t } = useTranslation();
  const sections = getHelpSectionsForRole(role);
  const faqItems = getHelpFaqForRole(role);

  return (
    <div>
      <PageIntro
        title={t("help.title")}
        description={t(
          role === "admin" ? "help.descriptionAdmin" : "help.descriptionStaff",
        )}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <HelpSectionCard
            key={section.id}
            section={section}
            role={role}
            t={t}
          />
        ))}
      </div>

      <section className="surface-card mt-4 p-5 sm:p-6">
        <h3 className="text-base font-semibold text-[#172033]">
          {t("help.faq.title")}
        </h3>
        <p className="mt-2 text-sm text-[#6B7890]">{t("help.faq.description")}</p>
        <div className="mt-4 space-y-3">
          {faqItems.map((item) => (
            <details
              key={item.id}
              className="group rounded-xl border border-[#EEF3F8] bg-[#FAFBFD] px-4 py-3"
            >
              <summary className="cursor-pointer list-none text-sm font-semibold text-[#172033] marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="flex items-start justify-between gap-3">
                  <span>{t(item.questionKey)}</span>
                  <span
                    className="shrink-0 text-xs font-normal text-[#6B7890] group-open:hidden"
                    aria-hidden
                  >
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-[#6B7890]">
                {t(item.answerKey, HELP_I18N_PARAMS[item.answerKey])}
              </p>
            </details>
          ))}
        </div>
      </section>

      <p className="mt-6 text-sm text-[#6B7890]">{t("help.readOnlyNotice")}</p>
    </div>
  );
}
