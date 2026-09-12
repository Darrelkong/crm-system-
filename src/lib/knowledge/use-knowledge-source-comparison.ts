"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeComparisonDetail } from "@/lib/knowledge/comparison-types";
import {
  canExecuteKnowledgeComparison,
  canViewKnowledgeComparison,
} from "@/lib/knowledge/knowledge-comparison-capabilities";
import {
  fetchKnowledgeComparison,
  isKnowledgeComparisonAbortError,
  triggerKnowledgeComparison,
} from "@/lib/knowledge/knowledge-comparison-client";
import {
  createKnowledgeComparisonRequestGuard,
  isComparisonProcessing,
  shouldAutoCompareAfterOrganize,
} from "@/lib/knowledge/knowledge-comparison-orchestration";
import {
  getKnowledgeErrorMessage,
  KnowledgeApiClientError,
} from "@/lib/knowledge/error-messages";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import type { KnowledgeSourceStatus } from "../../../drizzle/schema/knowledge-sources";

type Translate = (key: string, params?: Record<string, string>) => string;

export function useKnowledgeSourceComparison(input: {
  sourceId: string | null;
  role: KnowledgeRole | null;
  userId: string;
  sourceCreatedByUserId: string | null;
  sourceStatus: KnowledgeSourceStatus | null;
  organizationReady: boolean;
  t: Translate;
  autoCompareSignal?: number;
}) {
  const [comparison, setComparison] = useState<KnowledgeComparisonDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestGuardRef = useRef(createKnowledgeComparisonRequestGuard());
  const autoCompareAttemptedRef = useRef<string | null>(null);

  const canExecute = canExecuteKnowledgeComparison(
    input.role,
    input.userId,
    input.sourceCreatedByUserId,
  );
  const canView = canViewKnowledgeComparison(
    input.role,
    input.userId,
    input.sourceCreatedByUserId,
  );

  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const loadComparison = useCallback(async () => {
    if (!input.sourceId || !canView) {
      setComparison(null);
      setLoading(false);
      setError(null);
      return;
    }

    cancelRequest();
    const requestId = requestGuardRef.current.begin();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const next = await fetchKnowledgeComparison(input.sourceId, controller.signal);
      if (!requestGuardRef.current.isCurrent(requestId)) return;
      setComparison(next);
    } catch (caught) {
      if (!requestGuardRef.current.isCurrent(requestId)) return;
      if (isKnowledgeComparisonAbortError(caught)) return;
      setComparison(null);
      setError(
        caught instanceof KnowledgeApiClientError
          ? getKnowledgeErrorMessage(input.t, caught.errorCode)
          : input.t("knowledge.comparison.loadFailed"),
      );
    } finally {
      if (requestGuardRef.current.isCurrent(requestId)) {
        setLoading(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    }
  }, [canView, cancelRequest, input.sourceId, input.t]);

  const runComparison = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!input.sourceId || !canExecute) return;
      cancelRequest();
      const requestId = requestGuardRef.current.begin();
      const controller = new AbortController();
      abortRef.current = controller;
      setComparing(true);
      if (options?.manual) {
        setError(null);
      }

      try {
        const next = await triggerKnowledgeComparison(
          input.sourceId,
          controller.signal,
        );
        if (!requestGuardRef.current.isCurrent(requestId)) return;
        setComparison(next);
        setError(null);
      } catch (caught) {
        if (!requestGuardRef.current.isCurrent(requestId)) return;
        if (isKnowledgeComparisonAbortError(caught)) return;
        setError(
          caught instanceof KnowledgeApiClientError
            ? getKnowledgeErrorMessage(input.t, caught.errorCode)
            : input.t("knowledge.comparison.failedMessage"),
        );
        await loadComparison();
      } finally {
        if (requestGuardRef.current.isCurrent(requestId)) {
          setComparing(false);
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
        }
      }
    },
    [canExecute, cancelRequest, input.sourceId, input.t, loadComparison],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch comparison when source changes
    void loadComparison();
    return () => cancelRequest();
  }, [loadComparison, cancelRequest]);

  useEffect(() => {
    if (
      !shouldAutoCompareAfterOrganize({
        canExecute,
        organizationReady: input.organizationReady,
        sourceStatus: input.sourceStatus,
        sourceId: input.sourceId,
        autoCompareAttemptedForSourceId: autoCompareAttemptedRef.current,
      })
    ) {
      return;
    }
    autoCompareAttemptedRef.current = input.sourceId;
    void runComparison();
  }, [
    canExecute,
    input.autoCompareSignal,
    input.organizationReady,
    input.sourceId,
    input.sourceStatus,
    runComparison,
  ]);

  const processing =
    comparing || loading || isComparisonProcessing(comparison);

  return {
    comparison,
    loading,
    comparing,
    processing,
    error,
    canExecute,
    canView,
    loadComparison,
    runComparison,
    retryComparison: () => runComparison({ manual: true }),
  };
}
