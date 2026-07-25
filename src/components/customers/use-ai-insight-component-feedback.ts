"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "@/i18n/provider";
import type { AiInsightFeedbackRatingCode } from "@/lib/ai/customer-insights/feedback-contract";
import type { ComponentFeedbackUiTarget } from "@/components/customers/ai-insight-component-feedback";
import {
  AiInsightComponentFeedbackClient,
  type ComponentFeedbackClientSnapshot,
  type FeedbackHydrationStatus,
  type TargetFeedbackUiState,
} from "@/components/customers/ai-insight-component-feedback-client";

export type { FeedbackHydrationStatus, TargetFeedbackUiState };

export type UseAiInsightComponentFeedbackArgs = {
  customerId: string;
  /** Current ready insight generation — triggers re-GET when changed. */
  insightGeneratedAt: string | null;
  insightSourceHash: string | null;
  insightReady: boolean;
};

const EMPTY_SNAPSHOT: ComponentFeedbackClientSnapshot = {
  hydration: "idle",
  eligibility: null,
  targets: {
    base_deep: {
      rating: null,
      savedTags: [],
      draftTags: [],
      saving: false,
      statusMessage: null,
      error: null,
      generationMismatch: false,
    },
    phase2: {
      rating: null,
      savedTags: [],
      draftTags: [],
      saving: false,
      statusMessage: null,
      error: null,
      generationMismatch: false,
    },
    suggested_message: {
      rating: null,
      savedTags: [],
      draftTags: [],
      saving: false,
      statusMessage: null,
      error: null,
      generationMismatch: false,
    },
  },
  loadError: null,
  hasGeneration: false,
};

export function useAiInsightComponentFeedback({
  customerId,
  insightGeneratedAt,
  insightSourceHash,
  insightReady,
}: UseAiInsightComponentFeedbackArgs) {
  const { t } = useTranslation();
  const clientRef = useRef<AiInsightComponentFeedbackClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new AiInsightComponentFeedbackClient({
      unavailable: t("customers.aiInsightComponentFeedback.unavailable"),
      saveFailed: t("customers.aiInsightComponentFeedback.saveFailed"),
      generationMismatch: t(
        "customers.aiInsightComponentFeedback.generationMismatch",
      ),
      saved: t("customers.aiInsightComponentFeedback.saved"),
      updated: t("customers.aiInsightComponentFeedback.updated"),
    });
  }

  const client = clientRef.current;

  const snapshot = useSyncExternalStore(
    (onStoreChange) => client.subscribe(onStoreChange),
    () => client.getSnapshot(),
    () => EMPTY_SNAPSHOT,
  );

  useEffect(() => {
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [client]);

  useEffect(() => {
    void client.load({
      customerId,
      insightReady,
      insightGeneratedAt,
      insightSourceHash,
    });
  }, [
    client,
    customerId,
    insightGeneratedAt,
    insightSourceHash,
    insightReady,
  ]);

  const retryLoad = useCallback(() => {
    void client.retryLoad({
      customerId,
      insightReady,
      insightGeneratedAt,
      insightSourceHash,
    });
  }, [
    client,
    customerId,
    insightReady,
    insightGeneratedAt,
    insightSourceHash,
  ]);

  const clearGenerationMismatch = useCallback(() => {
    client.clearGenerationMismatch();
  }, [client]);

  const submitRating = useCallback(
    (target: ComponentFeedbackUiTarget, rating: AiInsightFeedbackRatingCode) => {
      client.submitRating(target, rating);
    },
    [client],
  );

  const toggleTag = useCallback(
    (target: ComponentFeedbackUiTarget, tag: string) => {
      client.toggleTag(target, tag);
    },
    [client],
  );

  const saveTags = useCallback(
    (target: ComponentFeedbackUiTarget) => {
      client.saveTags(target);
    },
    [client],
  );

  const hasUnsavedTags = useCallback(
    (target: ComponentFeedbackUiTarget) => client.hasUnsavedTags(target),
    [client],
  );

  return {
    hydration: snapshot.hydration,
    eligibility: snapshot.eligibility,
    targets: snapshot.targets,
    loadError: snapshot.loadError,
    retryLoad,
    submitRating,
    toggleTag,
    saveTags,
    clearGenerationMismatch,
    hasUnsavedTags,
  };
}
