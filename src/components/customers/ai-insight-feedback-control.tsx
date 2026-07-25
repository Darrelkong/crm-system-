"use client";

import { useTranslation } from "@/i18n/provider";
import {
  tagsForTargetRating,
  tagLabelKey,
  type ComponentFeedbackUiTarget,
} from "@/components/customers/ai-insight-component-feedback";
import { shouldShowComponentFeedbackControl } from "@/components/customers/ai-insight-component-feedback-client";
import type {
  TargetFeedbackUiState,
  FeedbackHydrationStatus,
} from "@/components/customers/use-ai-insight-component-feedback";
import type { AiInsightFeedbackRatingCode } from "@/lib/ai/customer-insights/feedback-contract";
import { ui } from "@/lib/ui/classes";

const cd = ui.customerDetail;

type Eligibility = {
  baseDeep: boolean;
  phase2: boolean;
  suggestedMessage: boolean;
} | null;

type Props = {
  target: ComponentFeedbackUiTarget;
  hydration: FeedbackHydrationStatus;
  eligibility: Eligibility;
  state: TargetFeedbackUiState;
  hasUnsavedTags: boolean;
  /** UI section actually rendered (server eligibility is also required). */
  sectionVisible: boolean;
  onSubmitRating: (
    target: ComponentFeedbackUiTarget,
    rating: AiInsightFeedbackRatingCode,
  ) => void;
  onToggleTag: (target: ComponentFeedbackUiTarget, tag: string) => void;
  onSaveTags: (target: ComponentFeedbackUiTarget) => void;
  onReloadAnalysis: () => void;
};

export function AiInsightFeedbackControl({
  target,
  hydration,
  eligibility,
  state,
  hasUnsavedTags,
  sectionVisible,
  onSubmitRating,
  onToggleTag,
  onSaveTags,
  onReloadAnalysis,
}: Props) {
  const { t } = useTranslation();

  if (
    !shouldShowComponentFeedbackControl({
      sectionVisible,
      hydration,
      eligibility,
      target,
    })
  ) {
    return null;
  }

  const saving = state.saving;
  const ratingOptions: {
    value: AiInsightFeedbackRatingCode;
    labelKey: string;
  }[] = [
    {
      value: "helpful",
      labelKey: "customers.aiInsightComponentFeedback.helpful",
    },
    {
      value: "not_helpful",
      labelKey: "customers.aiInsightComponentFeedback.notHelpful",
    },
  ];

  const availableTags =
    state.rating != null ? tagsForTargetRating(target, state.rating) : [];

  return (
    <div className="mt-3 rounded-md border border-[var(--color-crm-border-subtle)] bg-[var(--color-crm-surface-muted,transparent)] px-3 py-2">
      <p className={`text-xs font-medium ${cd.label}`}>
        {t("customers.aiInsightComponentFeedback.prompt")}
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {ratingOptions.map((option) => {
          const selected = state.rating === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={saving || state.generationMismatch}
              aria-pressed={selected}
              aria-busy={saving && selected}
              onClick={() => onSubmitRating(target, option.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "bg-slate-800 text-white ring-2 ring-slate-800 ring-offset-1 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-100"
                  : "bg-slate-100 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600"
              }`}
            >
              {t(option.labelKey)}
            </button>
          );
        })}
      </div>

      {state.rating && availableTags.length > 0 && (
        <div className="mt-3">
          <p className={`text-xs ${cd.muted}`}>
            {t("customers.aiInsightComponentFeedback.optionalReasons")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {availableTags.map((tag) => {
              const selected = state.draftTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  disabled={saving}
                  aria-pressed={selected}
                  onClick={() => onToggleTag(target, tag)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900"
                      : "bg-transparent text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-600"
                  }`}
                >
                  {t(tagLabelKey(target, tag))}
                </button>
              );
            })}
          </div>
          {hasUnsavedTags && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => onSaveTags(target)}
                className="customer-detail-action-btn px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? t("customers.aiInsightComponentFeedback.saving")
                  : t("customers.aiInsightComponentFeedback.saveReasons")}
              </button>
              <span className={`text-xs ${cd.muted}`} aria-live="polite">
                {t("customers.aiInsightComponentFeedback.reasonsUnsaved")}
              </span>
            </div>
          )}
        </div>
      )}

      {saving && (
        <p className={`mt-2 text-xs ${cd.muted}`} aria-live="polite">
          {t("customers.aiInsightComponentFeedback.saving")}
        </p>
      )}

      {!saving && state.statusMessage && (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400" aria-live="polite">
          {state.statusMessage}
        </p>
      )}

      {!saving && state.generationMismatch && (
        <div className="mt-2 space-y-2" role="status">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            {t("customers.aiInsightComponentFeedback.generationMismatch")}
          </p>
          <button
            type="button"
            className="customer-detail-action-btn px-2.5 py-1 text-xs"
            onClick={onReloadAnalysis}
          >
            {t("customers.aiInsightComponentFeedback.reloadAnalysis")}
          </button>
        </div>
      )}

      {!saving && state.error && !state.generationMismatch && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
