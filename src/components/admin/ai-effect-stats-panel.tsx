"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AI_EFFECT_STATS_ACTOR_ROLE_OPTIONS,
  AI_EFFECT_STATS_CONTRACT_OPTIONS,
  AI_EFFECT_STATS_DEFAULT_FILTERS,
  AI_EFFECT_STATS_FEEDBACK_TARGET_OPTIONS,
  AI_EFFECT_STATS_PHASE2_GENERATED_OPTIONS,
  AI_EFFECT_STATS_PROVIDER_OPTIONS,
  AI_EFFECT_STATS_RANGE_OPTIONS,
  mergeDimensionOptions,
  truncateDimensionLabel,
  type AiEffectStatsClientFilters,
  type AiEffectStatsRangeDays,
} from "@/components/admin/ai-effect-stats/ai-effect-stats-filters";
import {
  createAiEffectStatsSequenceGuard,
  fetchAiEffectStats,
  type AiEffectStatsFetchErrorKind,
} from "@/components/admin/ai-effect-stats/fetch-ai-effect-stats";
import {
  applyAiEffectStatsLoadResult,
  beginAiEffectStatsLoad,
  createInitialAiEffectStatsSession,
  type AiEffectStatsSessionState,
} from "@/components/admin/ai-effect-stats/ai-effect-stats-session";
import {
  componentTagI18nKey,
  degradationReasonI18nKey,
  formatAiEffectCount,
  formatAiEffectRate,
  legacyTagI18nKey,
} from "@/components/admin/ai-effect-stats/format-ai-effect-stats";
import {
  dataQualityHasIssues,
  type AiEffectStatsClientResponse,
  type AiEffectTargetFeedbackClient,
} from "@/components/admin/ai-effect-stats/parse-ai-effect-stats-response";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";

function MetricCard({
  label,
  value,
  subtext,
  hint,
}: {
  label: string;
  value: string;
  subtext?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--crm-border)] bg-[color:var(--crm-surface)] p-4">
      <h3 className="text-sm font-medium crm-text-muted">{label}</h3>
      <p className="mt-2 text-2xl font-semibold tabular-nums crm-text">{value}</p>
      {subtext ? (
        <p className="mt-1 text-xs tabular-nums crm-text-muted">{subtext}</p>
      ) : null}
      {hint ? <p className="mt-2 text-xs crm-text-muted">{hint}</p> : null}
    </div>
  );
}

function RateCard({
  label,
  rate,
  insufficientLabel,
  hint,
}: {
  label: string;
  rate: AiEffectStatsClientResponse["overview"]["baseSuccessRate"];
  insufficientLabel: string;
  hint?: string;
}) {
  const display = formatAiEffectRate(rate);
  return (
    <MetricCard
      label={label}
      value={
        display.kind === "insufficient"
          ? insufficientLabel
          : (display.percentText ?? insufficientLabel)
      }
      subtext={
        display.kind === "insufficient" ? undefined : display.fractionText
      }
      hint={hint}
    />
  );
}

function StatsTable({
  caption,
  headers,
  rows,
  emptyLabel,
}: {
  caption: string;
  headers: string[];
  rows: Array<Array<string>>;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm crm-text-muted">{emptyLabel}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm" aria-label={caption}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[color:var(--crm-border)] text-left crm-text-muted">
            {headers.map((header) => (
              <th key={header} scope="col" className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              className="border-b border-[color:var(--crm-border)] crm-text"
            >
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resolveLabel(
  t: (key: string) => string,
  key: string,
  fallback: string,
): string {
  const label = t(key);
  return label === key ? fallback : label;
}

function targetStatsRows(
  stats: AiEffectStatsClientResponse,
  t: (key: string) => string,
  insufficient: string,
): Array<Array<string>> {
  const entries: Array<{
    key: string;
    labelKey: string;
    data: AiEffectTargetFeedbackClient;
  }> = [
    {
      key: "base_deep",
      labelKey: "aiEffectStats.targets.base_deep",
      data: stats.feedback.byTarget.baseDeep,
    },
    {
      key: "phase2",
      labelKey: "aiEffectStats.targets.phase2",
      data: stats.feedback.byTarget.phase2,
    },
    {
      key: "suggested_message",
      labelKey: "aiEffectStats.targets.suggested_message",
      data: stats.feedback.byTarget.suggestedMessage,
    },
  ];

  return entries.map((entry) => {
    const rate = formatAiEffectRate(entry.data.helpfulRate);
    return [
      t(entry.labelKey),
      formatAiEffectCount(entry.data.submittedCount),
      formatAiEffectCount(entry.data.helpfulCount),
      formatAiEffectCount(entry.data.notHelpfulCount),
      rate.kind === "insufficient"
        ? insufficient
        : `${rate.percentText} (${rate.fractionText})`,
    ];
  });
}

function tagRows(
  tags: Array<{ code: string; count: number }>,
  labelFor: (code: string) => string,
): Array<Array<string>> {
  return tags.map((tag) => [
    labelFor(tag.code),
    formatAiEffectCount(tag.count),
  ]);
}

export function AiEffectStatsPanel() {
  const { t } = useTranslation();
  const [session, setSession] = useState<AiEffectStatsSessionState>(() =>
    createInitialAiEffectStatsSession(),
  );
  const guardRef = useRef(createAiEffectStatsSequenceGuard());
  const mountedRef = useRef(true);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const filters = session.filters;
  const stats = session.stats;
  const loadState = session.loadState;

  const errorMessage = (kind: AiEffectStatsFetchErrorKind): string => {
    if (kind === "data_limit") return t("aiEffectStats.errors.dataLimit");
    if (kind === "auth") return t("aiEffectStats.errors.auth");
    if (kind === "malformed") return t("aiEffectStats.errors.malformed");
    return t("aiEffectStats.errors.generic");
  };

  const load = useCallback(
    async (nextFilters: AiEffectStatsClientFilters, isInitial: boolean) => {
      const { sequence, signal } = guardRef.current.begin();
      if (mountedRef.current) {
        setSession((current) =>
          beginAiEffectStatsLoad(current, nextFilters, isInitial),
        );
      }

      const result = await fetchAiEffectStats(nextFilters, { signal });

      if (!mountedRef.current || !guardRef.current.isCurrent(sequence)) {
        return;
      }
      if (!result.ok && result.aborted) {
        return;
      }

      setSession((current) =>
        applyAiEffectStatsLoadResult(current, nextFilters, result),
      );
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    void load(AI_EFFECT_STATS_DEFAULT_FILTERS, true);
    return () => {
      mountedRef.current = false;
      guardRef.current.abort();
    };
  }, [load]);

  function updateFilter<K extends keyof AiEffectStatsClientFilters>(
    key: K,
    value: AiEffectStatsClientFilters[K],
  ) {
    const next = { ...sessionRef.current.filters, [key]: value };
    void load(next, false);
  }

  function resetFilters() {
    void load({ ...AI_EFFECT_STATS_DEFAULT_FILTERS }, false);
  }

  function retry() {
    void load(
      { ...sessionRef.current.filters },
      sessionRef.current.stats == null,
    );
  }

  const isUpdating =
    loadState.status === "loading" && !loadState.isInitial && stats != null;
  const isInitialLoading =
    loadState.status === "loading" && (loadState.isInitial || stats == null);
  const showError = loadState.status === "error" && stats == null;
  const showErrorBanner = loadState.status === "error" && stats != null;
  const controlsDisabled = loadState.status === "loading";

  const modelOptions = mergeDimensionOptions(
    filters.model,
    stats?.dimensions.models ?? [],
  );
  const promptOptions = mergeDimensionOptions(
    filters.promptVersion,
    stats?.dimensions.promptVersions ?? [],
  );

  const feedbackScopeNote =
    stats?.filterScope.feedbackOnly.includes("feedbackTarget") ?? true;

  return (
    <section
      className="surface-card mt-8 p-6"
      aria-labelledby="ai-effect-stats-title"
    >
      <div className="mb-4">
        <h2
          id="ai-effect-stats-title"
          className="text-lg font-semibold crm-text"
        >
          {t("aiEffectStats.title")}
        </h2>
        <p className="mt-1 text-sm crm-text-muted">
          {t("aiEffectStats.description")}
        </p>
      </div>

      <div className="mb-6 space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium crm-text">
            {t("aiEffectStats.filters.range")}
          </p>
          <div className="flex flex-wrap gap-2" role="group">
            {AI_EFFECT_STATS_RANGE_OPTIONS.map((days) => {
              const pressed = filters.range === days;
              return (
                <Button
                  key={days}
                  type="button"
                  size="sm"
                  variant={pressed ? "primary" : "secondary"}
                  aria-pressed={pressed}
                  disabled={controlsDisabled}
                  onClick={() =>
                    updateFilter("range", days as AiEffectStatsRangeDays)
                  }
                >
                  {t(`aiEffectStats.filters.range${days}`)}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div>
            <Label htmlFor="ai-effect-provider">
              {t("aiEffectStats.filters.provider")}
            </Label>
            <Select
              id="ai-effect-provider"
              value={filters.provider}
              disabled={controlsDisabled}
              onChange={(event) =>
                updateFilter("provider", event.target.value)
              }
            >
              {AI_EFFECT_STATS_PROVIDER_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`aiEffectStats.filters.providers.${value}`)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="ai-effect-model">
              {t("aiEffectStats.filters.model")}
            </Label>
            <Select
              id="ai-effect-model"
              value={filters.model}
              disabled={controlsDisabled}
              onChange={(event) => updateFilter("model", event.target.value)}
            >
              {modelOptions.map((value) => {
                if (value === "all") {
                  return (
                    <option key="all" value="all">
                      {t("aiEffectStats.filters.all")}
                    </option>
                  );
                }
                const truncated = truncateDimensionLabel(value);
                return (
                  <option key={value} value={value} title={truncated.title}>
                    {truncated.display}
                  </option>
                );
              })}
            </Select>
          </div>

          <div>
            <Label htmlFor="ai-effect-prompt">
              {t("aiEffectStats.filters.promptVersion")}
            </Label>
            <Select
              id="ai-effect-prompt"
              value={filters.promptVersion}
              disabled={controlsDisabled}
              onChange={(event) =>
                updateFilter("promptVersion", event.target.value)
              }
            >
              {promptOptions.map((value) => {
                if (value === "all") {
                  return (
                    <option key="all" value="all">
                      {t("aiEffectStats.filters.all")}
                    </option>
                  );
                }
                const truncated = truncateDimensionLabel(value);
                return (
                  <option key={value} value={value} title={truncated.title}>
                    {truncated.display}
                  </option>
                );
              })}
            </Select>
          </div>

          <div>
            <Label htmlFor="ai-effect-contract">
              {t("aiEffectStats.filters.contractMode")}
            </Label>
            <Select
              id="ai-effect-contract"
              value={filters.contractMode}
              disabled={controlsDisabled}
              onChange={(event) =>
                updateFilter("contractMode", event.target.value)
              }
            >
              {AI_EFFECT_STATS_CONTRACT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`aiEffectStats.filters.contractModes.${value}`)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="ai-effect-role">
              {t("aiEffectStats.filters.actorRole")}
            </Label>
            <Select
              id="ai-effect-role"
              value={filters.actorRole}
              disabled={controlsDisabled}
              onChange={(event) =>
                updateFilter("actorRole", event.target.value)
              }
            >
              {AI_EFFECT_STATS_ACTOR_ROLE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`aiEffectStats.filters.actorRoles.${value}`)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="ai-effect-target">
              {t("aiEffectStats.filters.feedbackTarget")}
            </Label>
            <Select
              id="ai-effect-target"
              value={filters.feedbackTarget}
              disabled={controlsDisabled}
              onChange={(event) =>
                updateFilter("feedbackTarget", event.target.value)
              }
            >
              {AI_EFFECT_STATS_FEEDBACK_TARGET_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`aiEffectStats.filters.feedbackTargets.${value}`)}
                </option>
              ))}
            </Select>
            {feedbackScopeNote ? (
              <p className="mt-1.5 text-xs crm-text-muted">
                {t("aiEffectStats.filters.feedbackTargetScopeNote")}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="ai-effect-phase2-generated">
              {t("aiEffectStats.filters.phase2Generated")}
            </Label>
            <Select
              id="ai-effect-phase2-generated"
              value={filters.phase2Generated}
              disabled={controlsDisabled}
              onChange={(event) =>
                updateFilter("phase2Generated", event.target.value)
              }
            >
              {AI_EFFECT_STATS_PHASE2_GENERATED_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`aiEffectStats.filters.phase2GeneratedOptions.${value}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={controlsDisabled}
            onClick={resetFilters}
          >
            {t("aiEffectStats.filters.reset")}
          </Button>
          <span className="text-sm crm-text-muted" aria-live="polite">
            {isUpdating ? t("aiEffectStats.updating") : null}
          </span>
        </div>
      </div>

      {isInitialLoading ? (
        <div
          className="space-y-3"
          aria-busy="true"
          aria-live="polite"
          aria-label={t("aiEffectStats.loading")}
        >
          <div className="h-4 w-40 animate-pulse rounded bg-[color:var(--crm-border)]" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-xl bg-[color:var(--crm-border)]"
              />
            ))}
          </div>
        </div>
      ) : null}

      {showError ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-red-700 dark:text-red-400">
            {errorMessage(loadState.kind)}
          </p>
          {loadState.kind !== "auth" ? (
            <Button type="button" size="sm" onClick={retry}>
              {t("aiEffectStats.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showErrorBanner ? (
        <div role="alert" className="mb-4 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">
            {errorMessage(loadState.kind)}
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={retry}>
            {t("aiEffectStats.retry")}
          </Button>
        </div>
      ) : null}

      {stats && !showError ? (
        <div className={`space-y-8 ${isUpdating ? "opacity-90" : ""}`}>
          <section aria-labelledby="ai-effect-overview-heading">
            <h3
              id="ai-effect-overview-heading"
              className="mb-3 text-base font-semibold crm-text"
            >
              {t("aiEffectStats.sections.overview")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
              <MetricCard
                label={t("aiEffectStats.cards.refreshAttempts")}
                value={formatAiEffectCount(
                  stats.overview.completedAttempts + stats.overview.failed,
                )}
              />
              <RateCard
                label={t("aiEffectStats.cards.baseSuccessRate")}
                rate={stats.overview.baseSuccessRate}
                insufficientLabel={t("aiEffectStats.insufficientData")}
                hint={t("aiEffectStats.cards.baseSuccessHint")}
              />
              <RateCard
                label={t("aiEffectStats.cards.refreshFailureRate")}
                rate={stats.overview.refreshFailureRate}
                insufficientLabel={t("aiEffectStats.insufficientData")}
                hint={t("aiEffectStats.cards.refreshFailureHint")}
              />
              <MetricCard
                label={t("aiEffectStats.cards.uniqueCustomers")}
                value={formatAiEffectCount(stats.overview.uniqueCustomers)}
              />
              <MetricCard
                label={t("aiEffectStats.cards.uniqueActors")}
                value={formatAiEffectCount(stats.overview.uniqueActors)}
              />
              <MetricCard
                label={t("aiEffectStats.cards.feedbackSubmitted")}
                value={formatAiEffectCount(stats.feedback.submitted)}
              />
            </div>

            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium crm-text">
                {t("aiEffectStats.sections.roleDistribution")}
              </h4>
              <StatsTable
                caption={t("aiEffectStats.sections.roleDistribution")}
                headers={[
                  t("aiEffectStats.table.role"),
                  t("aiEffectStats.table.count"),
                ]}
                emptyLabel={t("aiEffectStats.empty")}
                rows={
                  stats.overview.byActorRole.admin +
                    stats.overview.byActorRole.staff +
                    stats.overview.byActorRole.unknown ===
                  0
                    ? []
                    : [
                        [
                          t("aiEffectStats.roles.admin"),
                          formatAiEffectCount(stats.overview.byActorRole.admin),
                        ],
                        [
                          t("aiEffectStats.roles.staff"),
                          formatAiEffectCount(stats.overview.byActorRole.staff),
                        ],
                        [
                          t("aiEffectStats.roles.unknown"),
                          formatAiEffectCount(
                            stats.overview.byActorRole.unknown,
                          ),
                        ],
                      ]
                }
              />
            </div>

            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium crm-text">
                {t("aiEffectStats.sections.failures")}
              </h4>
              <StatsTable
                caption={t("aiEffectStats.sections.failures")}
                headers={[
                  t("aiEffectStats.table.category"),
                  t("aiEffectStats.table.count"),
                ]}
                emptyLabel={t("aiEffectStats.empty")}
                rows={[
                  [
                    t("aiEffectStats.failures.provider"),
                    formatAiEffectCount(stats.failures.provider),
                  ],
                  [
                    t("aiEffectStats.failures.nonProvider"),
                    formatAiEffectCount(stats.failures.nonProvider),
                  ],
                  [
                    t("aiEffectStats.failures.unknown"),
                    formatAiEffectCount(stats.failures.unknownStage),
                  ],
                ]}
              />
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs crm-text-muted">
                <li>{t("aiEffectStats.failures.providerHint")}</li>
                <li>{t("aiEffectStats.failures.unknownHint")}</li>
              </ul>
            </div>
          </section>

          <section aria-labelledby="ai-effect-phase2-heading">
            <h3
              id="ai-effect-phase2-heading"
              className="mb-3 text-base font-semibold crm-text"
            >
              {t("aiEffectStats.sections.phase2")}
            </h3>
            <p className="mb-3 text-sm crm-text-muted">
              {t("aiEffectStats.phase2.safeDegradationDescription")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard
                label={t("aiEffectStats.phase2.eligibleReady")}
                value={formatAiEffectCount(stats.phase2.eligibleReady)}
              />
              <MetricCard
                label={t("aiEffectStats.phase2.generated")}
                value={formatAiEffectCount(stats.phase2.generated)}
              />
              <MetricCard
                label={t("aiEffectStats.phase2.safeDegraded")}
                value={formatAiEffectCount(stats.phase2.safeDegraded)}
              />
              <MetricCard
                label={t("aiEffectStats.phase2.unknownOutcome")}
                value={formatAiEffectCount(stats.phase2.unknownOutcome)}
              />
              <RateCard
                label={t("aiEffectStats.phase2.generationRate")}
                rate={stats.phase2.generationRate}
                insufficientLabel={t("aiEffectStats.insufficientData")}
              />
              <RateCard
                label={t("aiEffectStats.phase2.safeDegradationRate")}
                rate={stats.phase2.safeDegradationRate}
                insufficientLabel={t("aiEffectStats.insufficientData")}
              />
            </div>

            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium crm-text">
                {t("aiEffectStats.phase2.eligibilitySecondary")}
              </h4>
              <StatsTable
                caption={t("aiEffectStats.phase2.eligibilitySecondary")}
                headers={[
                  t("aiEffectStats.table.category"),
                  t("aiEffectStats.table.count"),
                ]}
                emptyLabel={t("aiEffectStats.empty")}
                rows={[
                  [
                    t("aiEffectStats.phase2.ineligibleReady"),
                    formatAiEffectCount(stats.phase2.ineligibleReady),
                  ],
                  [
                    t("aiEffectStats.phase2.unknownEligibility"),
                    formatAiEffectCount(stats.phase2.unknownEligibility),
                  ],
                ]}
              />
            </div>

            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium crm-text">
                {t("aiEffectStats.phase2.degradationReasons")}
              </h4>
              <StatsTable
                caption={t("aiEffectStats.phase2.degradationReasons")}
                headers={[
                  t("aiEffectStats.table.reason"),
                  t("aiEffectStats.table.count"),
                ]}
                emptyLabel={t("aiEffectStats.phase2.noDegradationReasons")}
                rows={stats.phase2.degradationReasons.map((row) => [
                  resolveLabel(
                    t,
                    degradationReasonI18nKey(row.code),
                    t("aiEffectStats.degradationReasons.unknown"),
                  ),
                  formatAiEffectCount(row.count),
                ])}
              />
            </div>
          </section>

          <section aria-labelledby="ai-effect-feedback-heading">
            <h3
              id="ai-effect-feedback-heading"
              className="mb-3 text-base font-semibold crm-text"
            >
              {t("aiEffectStats.sections.componentFeedback")}
            </h3>
            <StatsTable
              caption={t("aiEffectStats.sections.componentFeedback")}
              headers={[
                t("aiEffectStats.table.target"),
                t("aiEffectStats.table.submitted"),
                t("aiEffectStats.table.helpful"),
                t("aiEffectStats.table.notHelpful"),
                t("aiEffectStats.table.helpfulRate"),
              ]}
              emptyLabel={t("aiEffectStats.empty")}
              rows={targetStatsRows(
                stats,
                t,
                t("aiEffectStats.insufficientData"),
              )}
            />

            {(
              [
                {
                  target: "base_deep" as const,
                  data: stats.feedback.byTarget.baseDeep,
                  label: t("aiEffectStats.targets.base_deep"),
                },
                {
                  target: "phase2" as const,
                  data: stats.feedback.byTarget.phase2,
                  label: t("aiEffectStats.targets.phase2"),
                },
                {
                  target: "suggested_message" as const,
                  data: stats.feedback.byTarget.suggestedMessage,
                  label: t("aiEffectStats.targets.suggested_message"),
                },
              ] as const
            ).map((block) => (
              <div key={block.target} className="mt-4 space-y-3">
                <h4 className="text-sm font-medium crm-text">{block.label}</h4>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium crm-text-muted">
                      {t("aiEffectStats.feedback.topHelpfulReasons")}
                    </p>
                    <StatsTable
                      caption={`${block.label} — ${t("aiEffectStats.feedback.topHelpfulReasons")}`}
                      headers={[
                        t("aiEffectStats.table.reason"),
                        t("aiEffectStats.table.count"),
                      ]}
                      emptyLabel={t("aiEffectStats.feedback.noTags")}
                      rows={tagRows(block.data.positiveTags, (code) =>
                        resolveLabel(
                          t,
                          componentTagI18nKey(block.target, code),
                          t("aiEffectStats.unknown"),
                        ),
                      )}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium crm-text-muted">
                      {t("aiEffectStats.feedback.topNotHelpfulReasons")}
                    </p>
                    <StatsTable
                      caption={`${block.label} — ${t("aiEffectStats.feedback.topNotHelpfulReasons")}`}
                      headers={[
                        t("aiEffectStats.table.reason"),
                        t("aiEffectStats.table.count"),
                      ]}
                      emptyLabel={t("aiEffectStats.feedback.noTags")}
                      rows={tagRows(block.data.negativeTags, (code) =>
                        resolveLabel(
                          t,
                          componentTagI18nKey(block.target, code),
                          t("aiEffectStats.unknown"),
                        ),
                      )}
                    />
                  </div>
                </div>
              </div>
            ))}

            <div className="mt-4 rounded-lg border border-[color:var(--crm-border)] p-4">
              <h4 className="text-sm font-medium crm-text">
                {t("aiEffectStats.coverage.title")}
              </h4>
              <p className="mt-1 text-sm crm-text-muted">
                {t("aiEffectStats.coverage.unavailable")}
              </p>
              <p className="mt-2 text-xs crm-text-muted">
                {t("aiEffectStats.coverage.explanation")}
              </p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="crm-text-muted">
                    {t("aiEffectStats.coverage.submittedFeedback")}
                  </dt>
                  <dd className="font-medium tabular-nums crm-text">
                    {formatAiEffectCount(stats.feedback.submitted)}
                  </dd>
                </div>
                <div>
                  <dt className="crm-text-muted">
                    {t("aiEffectStats.coverage.uniqueFeedbackActors")}
                  </dt>
                  <dd className="font-medium tabular-nums crm-text">
                    {formatAiEffectCount(stats.feedback.uniqueActors)}
                  </dd>
                </div>
                <div>
                  <dt className="crm-text-muted">
                    {t("aiEffectStats.coverage.uniqueFeedbackGenerations")}
                  </dt>
                  <dd className="font-medium tabular-nums crm-text">
                    {formatAiEffectCount(stats.feedback.uniqueGenerations)}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section aria-labelledby="ai-effect-legacy-heading">
            <h3
              id="ai-effect-legacy-heading"
              className="mb-3 text-base font-semibold crm-text"
            >
              {t("aiEffectStats.legacy.title")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard
                label={t("aiEffectStats.legacy.submitted")}
                value={formatAiEffectCount(stats.legacyFeedback.submittedCount)}
              />
              <MetricCard
                label={t("aiEffectStats.legacy.averageRating")}
                value={
                  stats.legacyFeedback.averageRating == null
                    ? t("aiEffectStats.insufficientData")
                    : stats.legacyFeedback.averageRating.toFixed(1)
                }
              />
              <MetricCard
                label={t("aiEffectStats.legacy.helpful")}
                value={formatAiEffectCount(stats.legacyFeedback.helpfulCount)}
              />
              <MetricCard
                label={t("aiEffectStats.legacy.neutral")}
                value={formatAiEffectCount(stats.legacyFeedback.neutralCount)}
              />
              <MetricCard
                label={t("aiEffectStats.legacy.notHelpful")}
                value={formatAiEffectCount(
                  stats.legacyFeedback.notHelpfulCount,
                )}
              />
            </div>
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium crm-text">
                {t("aiEffectStats.legacy.tags")}
              </h4>
              <StatsTable
                caption={t("aiEffectStats.legacy.tags")}
                headers={[
                  t("aiEffectStats.table.reason"),
                  t("aiEffectStats.table.count"),
                ]}
                emptyLabel={t("aiEffectStats.feedback.noTags")}
                rows={tagRows(stats.legacyFeedback.tagCounts, (code) =>
                  resolveLabel(
                    t,
                    legacyTagI18nKey(code),
                    t("aiEffectStats.unknown"),
                  ),
                )}
              />
            </div>
          </section>

          <section aria-labelledby="ai-effect-quality-heading">
            <h3
              id="ai-effect-quality-heading"
              className="mb-3 text-base font-semibold crm-text"
            >
              {t("aiEffectStats.dataQuality.title")}
            </h3>
            {dataQualityHasIssues(stats.dataQuality) ? (
              <div className="rounded-lg border border-[color:var(--crm-border)] p-4">
                <p className="text-sm crm-text-muted">
                  {t("aiEffectStats.dataQuality.notice")}
                </p>
                <StatsTable
                  caption={t("aiEffectStats.dataQuality.title")}
                  headers={[
                    t("aiEffectStats.table.category"),
                    t("aiEffectStats.table.count"),
                  ]}
                  emptyLabel={t("aiEffectStats.empty")}
                  rows={(
                    [
                      [
                        "legacyRefreshEvents",
                        stats.dataQuality.legacyRefreshEvents,
                      ],
                      [
                        "unknownProviderEvents",
                        stats.dataQuality.unknownProviderEvents,
                      ],
                      [
                        "unknownContractEvents",
                        stats.dataQuality.unknownContractEvents,
                      ],
                      [
                        "unknownActorRoleEvents",
                        stats.dataQuality.unknownActorRoleEvents,
                      ],
                      [
                        "unknownPhase2OutcomeEvents",
                        stats.dataQuality.unknownPhase2OutcomeEvents,
                      ],
                      ["invalidTagRows", stats.dataQuality.invalidTagRows],
                      [
                        "malformedAuditMetadataEvents",
                        stats.dataQuality.malformedAuditMetadataEvents,
                      ],
                    ] as const
                  )
                    .filter(([, count]) => count > 0)
                    .map(([key, count]) => [
                      t(`aiEffectStats.dataQuality.fields.${key}`),
                      formatAiEffectCount(count),
                    ])}
                />
              </div>
            ) : (
              <p className="text-sm crm-text-muted">
                {t("aiEffectStats.dataQuality.ok")}
              </p>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
