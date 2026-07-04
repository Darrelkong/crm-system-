"use client";

import { Badge } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import {
  getHelpFaqForRole,
  getHelpSectionsForRole,
  type HelpSectionConfig,
} from "@/lib/help/sections";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import { useTranslation } from "@/i18n/provider";

const RECLAIM_DAYS = SETTING_DEFAULTS.automatic_reclaim_days;
const RECLAIM_WARNING_DAYS = SETTING_DEFAULTS.reclaim_warning_days_before;
const POOL_QUOTA = SETTING_DEFAULTS.public_pool_claim_quota_7_days;
const POOL_COOLDOWN_HOURS = SETTING_DEFAULTS.public_pool_claim_cooldown_hours;
const CREATE_CONFIRM_SECONDS = "5";
const WELCOME_COUNTDOWN_SECONDS = "5";

const HELP_I18N_PARAMS: Record<string, Record<string, string>> = {
  "help.sections.addCustomer.items.confirmBeforeCreate": {
    seconds: CREATE_CONFIRM_SECONDS,
  },
  "help.sections.avoidPublicPool.items.watchReminders": {
    warningDays: RECLAIM_WARNING_DAYS,
    reclaimDays: RECLAIM_DAYS,
  },
  "help.sections.claimFromPool.items.howToClaim": {
    quota: POOL_QUOTA,
    hours: POOL_COOLDOWN_HOURS,
  },
  "help.sections.announcements.items.staffCountdown": {
    seconds: WELCOME_COUNTDOWN_SECONDS,
  },
  "help.faq.customerInPublicPool.answer": {
    reclaimDays: RECLAIM_DAYS,
  },
  "help.faq.createConfirmWait.answer": {
    seconds: CREATE_CONFIRM_SECONDS,
  },
  "help.faq.cannotClaimPool.answer": {
    quota: POOL_QUOTA,
    hours: POOL_COOLDOWN_HOURS,
  },
};

function HelpSectionCard({
  section,
  t,
}: {
  section: HelpSectionConfig;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  return (
    <section className="surface-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-[#172033]">
          {t(section.titleKey)}
        </h3>
        {section.testingPhase && (
          <Badge variant="accent">{t("help.testingPhaseBadge")}</Badge>
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
      <PageIntro title={t("help.title")} description={t("help.description")} />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <HelpSectionCard key={section.id} section={section} t={t} />
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
