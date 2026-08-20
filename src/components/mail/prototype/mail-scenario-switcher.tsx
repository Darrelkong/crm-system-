"use client";

import { cn } from "@/lib/cn";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import type { MailPrototypeScenario } from "@/lib/mail/prototype/types";
import { useTranslation } from "@/i18n/provider";

const SCENARIOS: { id: MailPrototypeScenario; labelKey: string }[] = [
  { id: "admin", labelKey: "mail.prototype.scenarioAdmin" },
  { id: "staff_single", labelKey: "mail.prototype.scenarioStaffSingle" },
  { id: "staff_multiple", labelKey: "mail.prototype.scenarioStaffMultiple" },
  { id: "staff_b", labelKey: "mail.prototype.scenarioStaffB" },
  { id: "staff_no_access", labelKey: "mail.prototype.scenarioNoAccess" },
  { id: "shared_mailbox", labelKey: "mail.prototype.scenarioShared" },
];

export function MailScenarioSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { scenario, setScenario } = useMailPrototype();
  const current = SCENARIOS.find((s) => s.id === scenario);

  return (
    <label
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300",
        className,
      )}
    >
      <span className="shrink-0 font-semibold">{t("mail.prototype.badge")}</span>
      <span className="shrink-0 opacity-60">·</span>
      <select
        value={scenario}
        onChange={(e) => setScenario(e.target.value as MailPrototypeScenario)}
        className="min-w-0 max-w-[9rem] truncate border-0 bg-transparent py-0.5 text-[11px] font-medium crm-text outline-none sm:max-w-[11rem]"
        aria-label={t("mail.prototype.scenarioLabel")}
      >
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id}>
            {t(s.labelKey)}
          </option>
        ))}
      </select>
      <span className="sr-only">{current ? t(current.labelKey) : ""}</span>
    </label>
  );
}
