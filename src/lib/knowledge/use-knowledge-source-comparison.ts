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
  isKnowledgeComparisonClientTimeoutError,
  KNOWLEDGE_COMPARISON_CLIENT_TIMEOUT_MS,
  KnowledgeComparisonClientTimeoutError,
  shouldAutoCompareAfterOrganize,
} from "@/lib/knowledge/knowledge-comparison-orchestration";
import {
  getKnowledgeErrorMessage,
  KnowledgeApiClientError,
} from "@/lib/knowledge/error-messages";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import type { KnowledgeSourceStatus } from "../../../drizzle/schema/knowledge-sources";

type Translate = (key: string, params?: Record<string, string>) => string;

function withClientTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  controller: AbortController,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      controller.abort();
      reject(new KnowledgeComparisonClientTimeoutError());
    }, timeoutMs);

    void operation(controller.signal)
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

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
  const {
    sourceId,
    role,
    userId,
    sourceCreatedByUserId,
    sourceStatus,
    organizationReady,
    t,
    autoCompareSignal = 0,
  } = input;

  const [comparison, setComparison] = useState<KnowledgeComparisonDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const compareAbortRef = useRef<AbortController | null>(null);
  const loadRequestGuardRef = useRef(createKnowledgeComparisonRequestGuard());
  const compareRequestGuardRef = useRef(createKnowledgeComparisonRequestGuard());
  const autoCompareAttemptedRef = useRef<string | null>(null);
  const lastAutoCompareSignalRef = useRef(0);

  const canExecute = canExecuteKnowledgeComparison(
    role,
    userId,
    sourceCreatedByUserId,
  );
  const canView = canViewKnowledgeComparison(
    role,
    userId,
    sourceCreatedByUserId,
  );

  const cancelLoad = useCallback(() => {
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
  }, []);

  const cancelCompare = useCallback(() => {
    compareAbortRef.current?.abort();
    compareAbortRef.current = null;
  }, []);

  const loadComparison = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!sourceId || !canView) {
        setComparison(null);
        setLoading(false);
        setError(null);
        setTimedOut(false);
        return;
      }

      cancelLoad();
      const requestId = loadRequestGuardRef.current.begin();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      setTimedOut(false);
      if (!options?.silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const next = await fetchKnowledgeComparison(sourceId, controller.signal);
        if (!loadRequestGuardRef.current.isCurrent(requestId)) return;
        setComparison(next);
        if (next?.status === "completed" || next?.status === "failed") {
          setTimedOut(false);
        }
      } catch (caught) {
        if (!loadRequestGuardRef.current.isCurrent(requestId)) return;
        if (isKnowledgeComparisonAbortError(caught)) return;
        setComparison(null);
        setError(
          caught instanceof KnowledgeApiClientError
            ? getKnowledgeErrorMessage(t, caught.errorCode)
            : t("knowledge.comparison.loadFailed"),
        );
      } finally {
        if (loadRequestGuardRef.current.isCurrent(requestId)) {
          setLoading(false);
          if (loadAbortRef.current === controller) {
            loadAbortRef.current = null;
          }
        }
      }
    },
    [canView, cancelLoad, sourceId, t],
  );

  const runComparison = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!sourceId || !canExecute) return;
      cancelCompare();
      const requestId = compareRequestGuardRef.current.begin();
      const controller = new AbortController();
      compareAbortRef.current = controller;
      setComparing(true);
      setTimedOut(false);
      if (options?.manual) {
        setError(null);
      }

      try {
        const next = await withClientTimeout(
          (signal) => triggerKnowledgeComparison(sourceId, signal),
          controller,
          KNOWLEDGE_COMPARISON_CLIENT_TIMEOUT_MS,
        );
        if (!compareRequestGuardRef.current.isCurrent(requestId)) return;
        setComparison(next);
        setError(null);
        setTimedOut(false);
      } catch (caught) {
        if (!compareRequestGuardRef.current.isCurrent(requestId)) return;
        if (isKnowledgeComparisonAbortError(caught)) return;
        if (isKnowledgeComparisonClientTimeoutError(caught)) {
          setTimedOut(true);
          setError(t("knowledge.comparison.failedMessage"));
          await loadComparison({ silent: true });
          return;
        }
        setError(
          caught instanceof KnowledgeApiClientError
            ? getKnowledgeErrorMessage(t, caught.errorCode)
            : t("knowledge.comparison.failedMessage"),
        );
        await loadComparison({ silent: true });
      } finally {
        setComparing(false);
        if (compareAbortRef.current === controller) {
          compareAbortRef.current = null;
        }
      }
    },
    [canExecute, cancelCompare, loadComparison, sourceId, t],
  );

  useEffect(() => {
    autoCompareAttemptedRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch comparison when source changes
    void loadComparison();
    return () => {
      cancelLoad();
      cancelCompare();
    };
  }, [sourceId, cancelCompare, cancelLoad, loadComparison]);

  useEffect(() => {
    if (autoCompareSignal === lastAutoCompareSignalRef.current) {
      return;
    }
    lastAutoCompareSignalRef.current = autoCompareSignal;
    autoCompareAttemptedRef.current = null;
  }, [autoCompareSignal]);

  useEffect(() => {
    if (
      !shouldAutoCompareAfterOrganize({
        canExecute,
        organizationReady,
        sourceStatus,
        sourceId,
        autoCompareAttemptedForSourceId: autoCompareAttemptedRef.current,
      })
    ) {
      return;
    }
    autoCompareAttemptedRef.current = sourceId;
    void runComparison();
  }, [
    autoCompareSignal,
    canExecute,
    organizationReady,
    runComparison,
    sourceId,
    sourceStatus,
  ]);

  useEffect(() => {
    if (timedOut || comparing || !comparison) return;
    if (!isComparisonProcessing(comparison)) return;

    const startedAt = Date.parse(comparison.createdAt);
    if (!Number.isFinite(startedAt)) return;

    const remainingMs = Math.max(
      0,
      KNOWLEDGE_COMPARISON_CLIENT_TIMEOUT_MS - (Date.now() - startedAt),
    );
    const timer = window.setTimeout(() => {
      setTimedOut(true);
      setError(t("knowledge.comparison.failedMessage"));
      void loadComparison({ silent: true });
    }, remainingMs);

    return () => window.clearTimeout(timer);
  }, [comparison, comparing, loadComparison, t, timedOut]);

  const processing =
    !timedOut &&
    (comparing || loading || isComparisonProcessing(comparison));

  return {
    comparison,
    loading,
    comparing,
    timedOut,
    processing,
    error,
    canExecute,
    canView,
    loadComparison,
    runComparison,
    retryComparison: () => runComparison({ manual: true }),
  };
}
