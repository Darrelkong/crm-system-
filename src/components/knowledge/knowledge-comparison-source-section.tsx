"use client";

import { useTranslation } from "@/i18n/provider";
import { KnowledgeComparisonPanel } from "@/components/knowledge/knowledge-comparison-panel";
import { useKnowledgeSourceComparison } from "@/lib/knowledge/use-knowledge-source-comparison";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import type { KnowledgeSourceStatus } from "../../../drizzle/schema/knowledge-sources";

export function KnowledgeComparisonSourceSection({
  sourceId,
  sourceCreatedByUserId,
  sourceStatus,
  organizationReady,
  role,
  userId,
  autoCompareSignal = 0,
  onCreateDraft,
  className,
}: {
  sourceId: string | null;
  sourceCreatedByUserId: string | null;
  sourceStatus: KnowledgeSourceStatus | null;
  organizationReady: boolean;
  role: KnowledgeRole | null;
  userId: string;
  autoCompareSignal?: number;
  onCreateDraft?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const comparisonState = useKnowledgeSourceComparison({
    sourceId,
    role,
    userId,
    sourceCreatedByUserId,
    sourceStatus,
    organizationReady,
    t,
    autoCompareSignal,
  });

  if (!comparisonState.canView) return null;

  return (
    <KnowledgeComparisonPanel
      sourceId={sourceId}
      comparison={comparisonState.comparison}
      loading={comparisonState.loading}
      comparing={comparisonState.comparing}
      processing={comparisonState.processing}
      timedOut={comparisonState.timedOut}
      error={comparisonState.error}
      canExecute={comparisonState.canExecute}
      canView={comparisonState.canView}
      onCompare={() => void comparisonState.runComparison({ manual: true })}
      onRetry={() => void comparisonState.retryComparison()}
      onCreateDraft={onCreateDraft}
      className={className}
    />
  );
}
