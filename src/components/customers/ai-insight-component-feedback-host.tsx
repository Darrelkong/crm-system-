"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useTranslation } from "@/i18n/provider";
import { AiInsightFeedbackControl } from "@/components/customers/ai-insight-feedback-control";
import {
  useAiInsightComponentFeedback,
  type FeedbackHydrationStatus,
} from "@/components/customers/use-ai-insight-component-feedback";
import type { ComponentFeedbackUiTarget } from "@/components/customers/ai-insight-component-feedback";
import { ui } from "@/lib/ui/classes";

const cd = ui.customerDetail;

export type AiInsightComponentFeedbackApi = ReturnType<
  typeof useAiInsightComponentFeedback
> & {
  reloadAnalysis: () => void;
  hydration: FeedbackHydrationStatus;
};

export function useAiInsightComponentFeedbackPanel(args: {
  customerId: string;
  insightGeneratedAt: string | null;
  insightSourceHash: string | null;
  insightReady: boolean;
  onReloadAnalysis: () => void;
}): AiInsightComponentFeedbackApi {
  const router = useRouter();
  const {
    customerId,
    insightGeneratedAt,
    insightSourceHash,
    insightReady,
    onReloadAnalysis,
  } = args;
  const feedback = useAiInsightComponentFeedback({
    customerId,
    insightGeneratedAt,
    insightSourceHash,
    insightReady,
  });

  const { clearGenerationMismatch } = feedback;

  const reloadAnalysis = useCallback(() => {
    clearGenerationMismatch();
    onReloadAnalysis();
    router.refresh();
  }, [clearGenerationMismatch, onReloadAnalysis, router]);

  return {
    ...feedback,
    reloadAnalysis,
  };
}

export function AiInsightFeedbackLoadError({
  api,
}: {
  api: AiInsightComponentFeedbackApi;
}) {
  const { t } = useTranslation();
  if (api.hydration !== "error" || !api.loadError) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <p className={`text-xs ${cd.muted}`}>{api.loadError}</p>
      <button
        type="button"
        className="customer-detail-action-btn px-2 py-1 text-xs"
        onClick={() => api.retryLoad()}
      >
        {t("customers.aiInsightComponentFeedback.retry")}
      </button>
    </div>
  );
}

export function AiInsightFeedbackSectionControl({
  api,
  target,
  sectionVisible,
}: {
  api: AiInsightComponentFeedbackApi;
  target: ComponentFeedbackUiTarget;
  sectionVisible: boolean;
}) {
  return (
    <AiInsightFeedbackControl
      target={target}
      hydration={api.hydration}
      eligibility={api.eligibility}
      state={api.targets[target]}
      hasUnsavedTags={api.hasUnsavedTags(target)}
      sectionVisible={sectionVisible}
      onSubmitRating={api.submitRating}
      onToggleTag={api.toggleTag}
      onSaveTags={api.saveTags}
      onReloadAnalysis={api.reloadAnalysis}
    />
  );
}
