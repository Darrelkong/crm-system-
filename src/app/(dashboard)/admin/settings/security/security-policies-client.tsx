"use client";

import { Badge } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import {
  INACTIVITY_LOGOUT_MINUTES,
  LOCKOUT_THRESHOLD,
} from "@/lib/auth/constants";
import { RECYCLE_BIN_RETENTION_DAYS } from "@/lib/recycle-bin/constants";
import { SECURITY_POLICY_SECTIONS } from "@/lib/security-policies/policies";
import { useTranslation } from "@/i18n/provider";

function policyDescriptionParams(
  policyId: string,
): Record<string, string> | undefined {
  switch (policyId) {
    case "login-lockout":
      return { count: String(LOCKOUT_THRESHOLD) };
    case "session-inactivity":
      return { minutes: String(INACTIVITY_LOGOUT_MINUTES) };
    case "customer-retention":
    case "customer-restore":
    case "customer-purge":
      return { days: String(RECYCLE_BIN_RETENTION_DAYS) };
    default:
      return undefined;
  }
}

export function SecurityPoliciesClient() {
  const { t } = useTranslation();

  return (
    <div>
      <PageIntro
        title={t("securityPolicies.title")}
        description={t("securityPolicies.description")}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {SECURITY_POLICY_SECTIONS.map((section) => (
          <section key={section.id} className="surface-card p-5 sm:p-6">
            <h3 className="text-base font-semibold text-[#172033]">
              {t(section.titleKey)}
            </h3>

            <ul className="mt-4 space-y-4">
              {section.policies.map((policy) => (
                <li
                  key={policy.id}
                  className="rounded-xl border border-[#EEF3F8] bg-[#FAFBFD] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-[#172033]">
                      {t(policy.titleKey)}
                    </p>
                    <Badge variant="success">
                      {t("securityPolicies.statusEnabled")}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7890]">
                    {t(
                      policy.descriptionKey,
                      policyDescriptionParams(policy.id),
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-6 text-sm text-[#6B7890]">
        {t("securityPolicies.readOnlyNotice")}
      </p>
    </div>
  );
}
