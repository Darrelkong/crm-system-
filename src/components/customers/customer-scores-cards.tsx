"use client";

import { Card } from "@/components/ui/card";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { formatHeatReasons } from "@/i18n/resolve-api-error";
import {
  HEAT_LEVEL_BADGE_CLASS,
} from "@/lib/customers/scoring/constants";
import type { CustomerWithScores } from "@/lib/customers/scoring/service";
import type { HeatLevel } from "@/lib/customers/scoring/types";

export function HeatBadge({ level }: { level: HeatLevel }) {
  const { heatLevel } = useCustomerLabels();
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${HEAT_LEVEL_BADGE_CLASS[level]}`}
    >
      {heatLevel(level)}
    </span>
  );
}

export function CompletenessBadge({ score }: { score: number }) {
  const { t } = useCustomerLabels();
  const variant =
    score >= 80
      ? "bg-green-100 text-green-800"
      : score >= 60
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${variant}`}>
      {t("customers.completenessPoints", { score: String(score) })}
    </span>
  );
}

export function CustomerScoresCards({
  scores,
  showMissingFields,
}: {
  scores: Pick<
    CustomerWithScores,
    | "heatLevel"
    | "completenessScore"
    | "heatReasonKeys"
    | "completenessMissingFields"
    | "accessLevel"
  >;
  showMissingFields: boolean;
}) {
  const { t, completenessField } = useCustomerLabels();

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <Card>
        <h3 className="text-sm font-semibold text-[#172033]">{t("customers.heatLevel")}</h3>
        <div className="mt-2">
          <HeatBadge level={scores.heatLevel} />
        </div>
        {scores.heatReasonKeys && scores.heatReasonKeys.length > 0 && (
          <p className="mt-2 text-sm text-[#6B7890]">
            {formatHeatReasons(t, scores.heatReasonKeys)}
          </p>
        )}
        <p className="mt-3 text-xs text-[#6B7890]">{t("customers.heatDescription")}</p>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-[#172033]">{t("customers.completeness")}</h3>
        <p className="mt-2 text-2xl font-semibold text-[#172033]">
          {scores.completenessScore}
          <span className="ml-1 text-sm font-normal text-[#6B7890]">/ 100</span>
        </p>
        {showMissingFields &&
        scores.completenessMissingFields &&
        scores.completenessMissingFields.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs font-medium text-[#6B7890]">{t("customers.missingFields")}</p>
            <ul className="mt-1 list-inside list-disc text-sm text-[#6B7890]">
              {scores.completenessMissingFields.map((field) => (
                <li key={field}>{completenessField(field)}</li>
              ))}
            </ul>
          </div>
        ) : scores.accessLevel !== "full" ? (
          <p className="mt-2 text-xs text-[#6B7890]">{t("customers.completenessRestricted")}</p>
        ) : (
          <p className="mt-2 text-sm text-green-700">{t("customers.completenessGood")}</p>
        )}
      </Card>
    </div>
  );
}
