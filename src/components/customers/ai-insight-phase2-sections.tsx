"use client";

import { useId, useState } from "react";
import type { Phase2Insight } from "@/lib/ai/phase2/types";
import { OPPORTUNITY_CATEGORY_CODES } from "@/lib/ai/phase2/types";
import { resolveOpportunityScoreDisplay } from "@/components/customers/phase2-panel-display";
import { formatHongKongDate, formatHongKongDateTime } from "@/lib/timezone";
import { ui } from "@/lib/ui/classes";

const cd = ui.customerDetail;

type TFn = (key: string, params?: Record<string, string>) => string;

function translateKey(t: TFn, key: string, fallback: string): string {
  const value = t(key);
  return value === key ? fallback : value;
}

function EvidenceDetails({
  t,
  evidence,
}: {
  t: TFn;
  evidence: Phase2Insight["painPoints"][number]["evidence"];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!evidence.length) return null;
  const genericSource = t("customers.phase2.sourceType.generic");
  return (
    <div className="mt-2 min-w-0">
      <button
        type="button"
        className="customer-detail-reveal-btn text-xs"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {t("customers.phase2.viewEvidence")}
      </button>
      {open && (
        <ul id={panelId} className="mt-2 space-y-2">
          {evidence.map((item, index) => {
            const fieldLabel = item.field
              ? translateKey(
                  t,
                  `customers.phase2.customerField.${item.field}`,
                  item.field,
                )
              : null;
            const sourceLabel = translateKey(
              t,
              `customers.phase2.sourceType.${item.sourceType}`,
              genericSource,
            );
            return (
              <li
                key={`${item.sourceType}-${item.occurredAt ?? ""}-${index}`}
                className="min-w-0 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/40"
              >
                <p className={`text-xs font-medium ${cd.label}`}>
                  {sourceLabel}
                  {item.occurredAt
                    ? ` · ${formatHongKongDateTime(item.occurredAt, item.occurredAt)}`
                    : ""}
                  {fieldLabel ? ` · ${fieldLabel}` : ""}
                </p>
                <p
                  className={`mt-1 whitespace-pre-wrap break-words text-sm ${cd.value}`}
                >
                  {item.excerpt}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ConfidenceBadge({
  t,
  level,
}: {
  t: TFn;
  level: "low" | "medium" | "high";
}) {
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600">
      {t(`customers.phase2.confidence.${level}`)}
    </span>
  );
}

export function AiInsightPhase2Sections({
  t,
  phase2,
}: {
  t: TFn;
  phase2: Phase2Insight;
}) {
  const opportunity = phase2.opportunity;
  const scoreDisplay = resolveOpportunityScoreDisplay(opportunity);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const breakdownId = useId();
  const recommendation = phase2.followUpRecommendation;
  const hasRecommendationContent = !!(
    recommendation.date ||
    recommendation.channel ||
    recommendation.topic ||
    recommendation.insufficientDataReason ||
    recommendation.basis.length > 0
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className="customer-detail-callout min-w-0 p-4">
        <h4 className="customer-detail-callout-title">
          {t("customers.phase2.opportunityTitle")}
        </h4>
        {scoreDisplay.kind === "score" ? (
          <div className="mt-2 space-y-2">
            <p className={`break-words text-2xl font-semibold ${cd.strongValue}`}>
              {scoreDisplay.score}
              <span className={`ml-1 text-sm font-normal ${cd.muted}`}>
                / 100
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <ConfidenceBadge t={t} level={opportunity.confidence} />
              <span className={`text-xs ${cd.muted}`}>
                {t("customers.phase2.confidenceHint")}
              </span>
            </div>
            {opportunity.recommendedAction && (
              <p className={`break-words text-sm ${cd.value}`}>
                {opportunity.recommendedAction}
              </p>
            )}
            <p className={`text-xs ${cd.muted}`}>
              {t("customers.phase2.opportunityDisclaimer")}
            </p>
          </div>
        ) : (
          <p className={`mt-2 text-sm ${cd.value}`}>
            {t("customers.phase2.opportunityInsufficient")}
          </p>
        )}

        <div className="mt-3">
          <button
            type="button"
            className="customer-detail-reveal-btn text-xs"
            aria-expanded={breakdownOpen}
            aria-controls={breakdownId}
            onClick={() => setBreakdownOpen((value) => !value)}
          >
            {t("customers.phase2.viewScoreDetails")}
          </button>
          {breakdownOpen && (
            <ul id={breakdownId} className="mt-3 space-y-2">
              {OPPORTUNITY_CATEGORY_CODES.map((code) => {
                const row = opportunity.breakdown.find(
                  (item) => item.code === code,
                );
                if (!row) return null;
                return (
                  <li
                    key={code}
                    className="min-w-0 rounded-md border border-slate-200 p-3 dark:border-slate-700"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={`text-sm font-medium ${cd.strongValue}`}>
                        {t(`customers.phase2.category.${code}`)}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-xs ${cd.muted}`}>
                          {t(`customers.phase2.categoryStatus.${row.status}`)}
                          {row.status === "scored" && row.score != null
                            ? ` · ${row.score}/100`
                            : ""}
                          {` · ${t("customers.phase2.weight", {
                            weight: String(row.weight),
                          })}`}
                        </span>
                        <ConfidenceBadge t={t} level={row.confidence} />
                      </div>
                    </div>
                    <p className={`mt-1 break-words text-sm ${cd.value}`}>
                      {row.explanation}
                    </p>
                    <EvidenceDetails t={t} evidence={row.basis} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {opportunity.positiveFactors.length > 0 && (
        <div className="min-w-0">
          <h4 className={cd.sectionTitle}>
            {t("customers.phase2.positiveFactors")}
          </h4>
          <ul className="mt-2 space-y-2">
            {opportunity.positiveFactors.map((factor) => (
              <li
                key={`pos-${factor.code}-${factor.summary}`}
                className="min-w-0 rounded-md border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`break-words text-sm ${cd.value}`}>
                    {factor.summary}
                  </p>
                  <ConfidenceBadge t={t} level={factor.confidence} />
                </div>
                <EvidenceDetails t={t} evidence={factor.evidence} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {opportunity.negativeFactors.length > 0 && (
        <div className="min-w-0">
          <h4 className={cd.sectionTitle}>
            {t("customers.phase2.limitingFactors")}
          </h4>
          <ul className="mt-2 space-y-2">
            {opportunity.negativeFactors.map((factor) => (
              <li
                key={`neg-${factor.code}-${factor.summary}`}
                className="min-w-0 rounded-md border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`break-words text-sm ${cd.value}`}>
                    {factor.summary}
                  </p>
                  <ConfidenceBadge t={t} level={factor.confidence} />
                </div>
                <EvidenceDetails t={t} evidence={factor.evidence} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase2.painPoints.length > 0 && (
        <div className="min-w-0">
          <h4 className={cd.sectionTitle}>
            {t("customers.phase2.painPointsTitle")}
          </h4>
          <ul className="mt-2 space-y-2">
            {phase2.painPoints.map((point) => (
              <li
                key={point.code}
                className="min-w-0 rounded-md border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm font-medium ${cd.strongValue}`}>
                    {translateKey(
                      t,
                      `customers.phase2.painPoint.${point.code}`,
                      point.summary,
                    )}
                  </p>
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600">
                    {t(`customers.phase2.severity.${point.severity}`)}
                  </span>
                  <ConfidenceBadge t={t} level={point.confidence} />
                </div>
                <p className={`mt-1 break-words text-sm ${cd.value}`}>
                  {point.summary}
                </p>
                {point.recommendedResponse && (
                  <p className={`mt-1 break-words text-sm ${cd.muted}`}>
                    {point.recommendedResponse}
                  </p>
                )}
                <EvidenceDetails t={t} evidence={point.evidence} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-w-0">
        <h4 className={cd.sectionTitle}>{t("customers.phase2.churnTitle")}</h4>
        {phase2.churnRisk.level === "insufficient_data" ? (
          <p className={`mt-2 text-sm ${cd.value}`}>
            {t("customers.phase2.churnInsufficient")}
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600">
                {t(`customers.phase2.churnLevel.${phase2.churnRisk.level}`)}
              </span>
              <ConfidenceBadge t={t} level={phase2.churnRisk.confidence} />
            </div>
            <p className={`break-words text-sm ${cd.value}`}>
              {phase2.churnRisk.summary}
            </p>
            {phase2.churnRisk.customerBehaviorRisk.length > 0 && (
              <div>
                <p className={`text-xs font-medium ${cd.label}`}>
                  {t("customers.phase2.customerBehaviorRisks")}
                </p>
                <ul className="mt-1 space-y-1">
                  {phase2.churnRisk.customerBehaviorRisk.map((risk) => (
                    <li
                      key={risk.code}
                      className={`break-words text-sm ${cd.value}`}
                    >
                      {risk.summary}
                      <EvidenceDetails t={t} evidence={risk.evidence} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {phase2.churnRisk.crmProcessRisk.length > 0 && (
              <div>
                <p className={`text-xs font-medium ${cd.label}`}>
                  {t("customers.phase2.crmProcessRisks")}
                </p>
                <ul className="mt-1 space-y-1">
                  {phase2.churnRisk.crmProcessRisk.map((risk) => (
                    <li
                      key={risk.code}
                      className={`break-words text-sm ${cd.value}`}
                    >
                      {risk.summary}
                      <EvidenceDetails t={t} evidence={risk.evidence} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {hasRecommendationContent && (
        <div className="min-w-0">
          <h4 className={cd.sectionTitle}>
            {t("customers.phase2.recommendationTitle")}
          </h4>
          <div className="mt-2 space-y-1 text-sm">
            {recommendation.date ? (
              <p className={`break-words ${cd.value}`}>
                {t("customers.phase2.recommendedDate")}:{" "}
                {formatHongKongDate(recommendation.date, recommendation.date)}
              </p>
            ) : null}
            {recommendation.channel ? (
              <p className={`break-words ${cd.value}`}>
                {t("customers.phase2.recommendedChannel")}:{" "}
                {recommendation.channel}
              </p>
            ) : null}
            {recommendation.topic ? (
              <p className={`break-words ${cd.value}`}>
                {t("customers.phase2.recommendedTopic")}: {recommendation.topic}
              </p>
            ) : null}
            {!recommendation.date &&
              !recommendation.channel &&
              !recommendation.topic &&
              recommendation.insufficientDataReason && (
                <p className={`break-words ${cd.value}`}>
                  {recommendation.insufficientDataReason}
                </p>
              )}
            {(recommendation.date ||
              recommendation.channel ||
              recommendation.topic) && (
              <ConfidenceBadge t={t} level={recommendation.confidence} />
            )}
            <EvidenceDetails t={t} evidence={recommendation.basis} />
          </div>
        </div>
      )}
    </div>
  );
}
