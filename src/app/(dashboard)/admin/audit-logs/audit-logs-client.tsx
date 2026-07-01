"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import type { AuditLogListItem } from "@/lib/audit/types";
import {
  buildAuditLogQueryParams,
  DEFAULT_AUDIT_LOG_FILTER_FORM,
  displayAuditField,
  formatAuditActorLabel,
  formatAuditMetadataForDisplay,
  type AuditLogFilterFormState,
} from "@/lib/audit/ui-helpers";
import { formatHongKongDateTime } from "@/lib/timezone";

type AuditLogListResponse = {
  ok?: boolean;
  items?: AuditLogListItem[];
  nextCursor?: string | null;
  error?: string;
};

function MetadataCell({
  metadata,
  emptyLabel,
  showLabel,
  hideLabel,
}: {
  metadata: Record<string, unknown> | null;
  emptyLabel: string;
  showLabel: string;
  hideLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const formatted = formatAuditMetadataForDisplay(metadata);

  if (!formatted) {
    return <span className="text-[#6B7890]">{emptyLabel}</span>;
  }

  return (
    <div className="max-w-md">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="text-sm font-medium text-[#2F6FB3] hover:underline"
      >
        {expanded ? hideLabel : showLabel}
      </button>
      {expanded ? (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[#E3E8F0] bg-[#F7FAFD] p-2 font-mono text-xs text-[#172033]">
          {formatted}
        </pre>
      ) : null}
    </div>
  );
}

export function AuditLogsClient() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AuditLogListItem[]>([]);
  const [draftFilters, setDraftFilters] = useState<AuditLogFilterFormState>(
    DEFAULT_AUDIT_LOG_FILTER_FORM,
  );
  const [appliedFilters, setAppliedFilters] = useState<AuditLogFilterFormState>(
    DEFAULT_AUDIT_LOG_FILTER_FORM,
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (filters: AuditLogFilterFormState, cursor?: string | null) => {
      const params = buildAuditLogQueryParams(filters, cursor);
      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`);
      const data = (await res.json()) as AuditLogListResponse;

      if (!res.ok) {
        throw new Error(data.error ?? t("audit.loadFailed"));
      }

      return {
        items: data.items ?? [],
        nextCursor: data.nextCursor ?? null,
      };
    },
    [t],
  );

  const loadInitial = useCallback(
    async (filters: AuditLogFilterFormState) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchPage(filters);
        setItems(result.items);
        setNextCursor(result.nextCursor);
      } catch (err) {
        setItems([]);
        setNextCursor(null);
        setError(err instanceof Error ? err.message : t("audit.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [fetchPage, t],
  );

  useEffect(() => {
    void loadInitial(appliedFilters);
  }, [appliedFilters, loadInitial]);

  function updateDraftField<K extends keyof AuditLogFilterFormState>(
    key: K,
    value: AuditLogFilterFormState[K],
  ) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function clearFilters() {
    setDraftFilters(DEFAULT_AUDIT_LOG_FILTER_FORM);
    setAppliedFilters(DEFAULT_AUDIT_LOG_FILTER_FORM);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) {
      return;
    }

    setLoadingMore(true);
    setError(null);
    try {
      const result = await fetchPage(appliedFilters, nextCursor);
      setItems((current) => [...current, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("audit.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <PageIntro
        title={t("audit.title")}
        description={t("audit.description")}
      />

      <div className="surface-card space-y-4 p-6">
        <div>
          <h3 className="text-sm font-semibold text-[#172033]">
            {t("audit.filters")}
          </h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label htmlFor="audit-filter-action">{t("audit.action")}</Label>
              <Input
                id="audit-filter-action"
                className="mt-1"
                value={draftFilters.action}
                onChange={(event) =>
                  updateDraftField("action", event.target.value)
                }
              />
            </div>
            <div>
              <Label htmlFor="audit-filter-entity-type">
                {t("audit.entityType")}
              </Label>
              <Input
                id="audit-filter-entity-type"
                className="mt-1"
                value={draftFilters.entityType}
                onChange={(event) =>
                  updateDraftField("entityType", event.target.value)
                }
              />
            </div>
            <div>
              <Label htmlFor="audit-filter-entity-id">
                {t("audit.entityId")}
              </Label>
              <Input
                id="audit-filter-entity-id"
                className="mt-1 font-mono text-xs"
                value={draftFilters.entityId}
                onChange={(event) =>
                  updateDraftField("entityId", event.target.value)
                }
              />
            </div>
            <div>
              <Label htmlFor="audit-filter-user-id">{t("audit.userId")}</Label>
              <Input
                id="audit-filter-user-id"
                className="mt-1 font-mono text-xs"
                value={draftFilters.userId}
                onChange={(event) =>
                  updateDraftField("userId", event.target.value)
                }
              />
            </div>
            <div>
              <Label htmlFor="audit-filter-date-from">
                {t("audit.dateFrom")}
              </Label>
              <Input
                id="audit-filter-date-from"
                type="datetime-local"
                className="mt-1"
                value={draftFilters.dateFrom}
                onChange={(event) =>
                  updateDraftField("dateFrom", event.target.value)
                }
              />
            </div>
            <div>
              <Label htmlFor="audit-filter-date-to">{t("audit.dateTo")}</Label>
              <Input
                id="audit-filter-date-to"
                type="datetime-local"
                className="mt-1"
                value={draftFilters.dateTo}
                onChange={(event) =>
                  updateDraftField("dateTo", event.target.value)
                }
              />
            </div>
            <div>
              <Label htmlFor="audit-filter-limit">{t("audit.limit")}</Label>
              <Input
                id="audit-filter-limit"
                type="number"
                min={1}
                max={100}
                className="mt-1"
                value={draftFilters.limit}
                onChange={(event) =>
                  updateDraftField("limit", event.target.value)
                }
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={applyFilters}>
              {t("audit.applyFilters")}
            </Button>
            <Button variant="secondary" onClick={clearFilters}>
              {t("audit.clearFilters")}
            </Button>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-[#6B7890]">{t("audit.loading")}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-[#6B7890]">{t("audit.noRecords")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="table-head border-b border-[#E3E8F0] text-[#6B7890]">
                  <th className="px-3 py-2">{t("audit.createdAt")}</th>
                  <th className="px-3 py-2">{t("audit.actor")}</th>
                  <th className="px-3 py-2">{t("audit.action")}</th>
                  <th className="px-3 py-2">{t("audit.entityType")}</th>
                  <th className="px-3 py-2">{t("audit.entityId")}</th>
                  <th className="px-3 py-2">{t("audit.ipAddress")}</th>
                  <th className="px-3 py-2">{t("audit.userAgent")}</th>
                  <th className="px-3 py-2">{t("audit.metadata")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="table-row border-b border-[#EEF3F8]">
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {formatHongKongDateTime(row.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      {formatAuditActorLabel(row, t("audit.systemActor"))}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs break-all">
                      {displayAuditField(row.action)}
                    </td>
                    <td className="px-3 py-2">
                      {displayAuditField(row.entityType)}
                    </td>
                    <td className="max-w-[12rem] px-3 py-2 font-mono text-xs break-all">
                      {displayAuditField(row.entityId)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {displayAuditField(row.ipAddress)}
                    </td>
                    <td className="max-w-xs px-3 py-2 text-xs break-all">
                      {displayAuditField(row.userAgent)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <MetadataCell
                        metadata={row.metadata}
                        emptyLabel={t("audit.metadataEmpty")}
                        showLabel={t("audit.showMetadata")}
                        hideLabel={t("audit.hideMetadata")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && nextCursor ? (
          <div className="flex justify-center pt-2">
            <Button
              variant="secondary"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? t("audit.loading") : t("audit.loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
