"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import type { KnowledgeCategoryListItem } from "@/lib/knowledge/core-service";
import { searchRequestedProjectItems } from "@/lib/constants/requested-projects";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";
import type { BusinessCategoryMappingAdminRow } from "@/lib/knowledge/knowledge-business-category-mapping-admin-service";

type GroupMeta = { groupCode: string; groupLabel: string; sortOrder: number };

function statusLabelKey(
  status: BusinessCategoryMappingAdminRow["status"],
): string {
  switch (status) {
    case "mapped":
      return "knowledge.categories.businessMappingStatusMapped";
    case "unmapped":
      return "knowledge.categories.businessMappingStatusUnmapped";
    case "category_inactive":
      return "knowledge.categories.businessMappingStatusCategoryInactive";
    case "mapping_inactive":
      return "knowledge.categories.businessMappingStatusMappingInactive";
    default:
      return "knowledge.categories.businessMappingStatusUnmapped";
  }
}

export function KnowledgeBusinessMappingAdmin({
  activeCategories,
}: {
  activeCategories: KnowledgeCategoryListItem[];
}) {
  const { t, locale } = useTranslation();
  const [rows, setRows] = useState<BusinessCategoryMappingAdminRow[]>([]);
  const [groups, setGroups] = useState<GroupMeta[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [successCode, setSuccessCode] = useState<string | null>(null);
  const [draftCategoryByCode, setDraftCategoryByCode] = useState<
    Record<string, string>
  >({});

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/knowledge/business-category-mappings?locale=${encodeURIComponent(locale)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        rows?: BusinessCategoryMappingAdminRow[];
        groups?: GroupMeta[];
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.rows) {
        throw new Error(
          resolveKnowledgeApiError(
            t,
            payload,
            "knowledge.categories.businessMappingLoadFailed",
          ),
        );
      }
      setRows(payload.rows);
      setGroups(payload.groups ?? []);
      const nextDraft: Record<string, string> = {};
      for (const row of payload.rows) {
        if (row.knowledgeCategoryId) {
          nextDraft[row.requestedProjectCode] = row.knowledgeCategoryId;
        }
      }
      setDraftCategoryByCode(nextDraft);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.categories.businessMappingLoadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [locale, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial mapping list fetch on mount
    void loadRows();
  }, [loadRows]);

  const filteredRows = useMemo(() => {
    const hits = searchRequestedProjectItems(search);
    const allowed = new Set(hits.map((hit) => hit.item.code));
    return rows.filter((row) => allowed.has(row.requestedProjectCode));
  }, [rows, search]);

  const rowsByGroup = useMemo(() => {
    const map = new Map<string, BusinessCategoryMappingAdminRow[]>();
    for (const row of filteredRows) {
      const list = map.get(row.groupCode) ?? [];
      list.push(row);
      map.set(row.groupCode, list);
    }
    return map;
  }, [filteredRows]);

  const orderedGroups = useMemo(() => {
    const codes = new Set(filteredRows.map((row) => row.groupCode));
    return groups
      .filter((group) => codes.has(group.groupCode))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [filteredRows, groups]);

  async function saveMapping(row: BusinessCategoryMappingAdminRow) {
    const categoryId =
      draftCategoryByCode[row.requestedProjectCode]?.trim() ?? "";
    if (!categoryId) return;
    setSavingCode(row.requestedProjectCode);
    setSuccessCode(null);
    setError(null);
    try {
      let response: Response;
      if (row.mappingId && row.mappingActive) {
        response = await fetch(
          `/api/knowledge/business-category-mappings/${row.mappingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ knowledgeCategoryId: categoryId }),
          },
        );
      } else if (row.mappingId && !row.mappingActive) {
        response = await fetch(
          `/api/knowledge/business-category-mappings/${row.mappingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              knowledgeCategoryId: categoryId,
              isActive: true,
            }),
          },
        );
      } else {
        response = await fetch("/api/knowledge/business-category-mappings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestedProjectCode: row.requestedProjectCode,
            knowledgeCategoryId: categoryId,
          }),
        });
      }
      const payload = (await response.json()) as {
        error?: string;
        errorCode?: string;
      };
      if (!response.ok) {
        throw new Error(
          resolveKnowledgeApiError(
            t,
            payload,
            "knowledge.categories.businessMappingSaveFailed",
          ),
        );
      }
      setSuccessCode(row.requestedProjectCode);
      await loadRows();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.categories.businessMappingSaveFailed"),
      );
    } finally {
      setSavingCode(null);
    }
  }

  async function deactivateMapping(row: BusinessCategoryMappingAdminRow) {
    if (!row.mappingId) return;
    setSavingCode(row.requestedProjectCode);
    setSuccessCode(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/knowledge/business-category-mappings/${row.mappingId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: false }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        errorCode?: string;
      };
      if (!response.ok) {
        throw new Error(
          resolveKnowledgeApiError(
            t,
            payload,
            "knowledge.categories.businessMappingSaveFailed",
          ),
        );
      }
      setSuccessCode(row.requestedProjectCode);
      await loadRows();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.categories.businessMappingSaveFailed"),
      );
    } finally {
      setSavingCode(null);
    }
  }

  if (loading) {
    return (
      <Card className="p-4 text-sm crm-text-secondary" data-business-mapping-loading="true">
        {t("common.loading")}
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-knowledge-business-mapping-admin="true">
      <Card className="p-3 sm:p-4">
        <h2 className="text-sm font-semibold crm-text">
          {t("knowledge.categories.businessMappingTitle")}
        </h2>
        <p className="mt-1 text-xs crm-text-secondary">
          {t("knowledge.categories.businessMappingDescription")}
        </p>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("knowledge.categories.businessMappingSearch")}
          aria-label={t("knowledge.categories.businessMappingSearch")}
          className="mt-3 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          data-business-mapping-search="true"
        />
      </Card>

      {error ? (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      ) : null}

      <div className="hidden gap-3 px-1 text-xs font-medium text-slate-500 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <span>{t("knowledge.categories.businessMappingCrmBusiness")}</span>
        <span>{t("knowledge.categories.businessMappingDefaultCategory")}</span>
        <span>{t("common.status")}</span>
      </div>

      {orderedGroups.map((group) => {
        const groupRows = rowsByGroup.get(group.groupCode) ?? [];
        if (groupRows.length === 0) return null;
        return (
          <section key={group.groupCode} className="space-y-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {group.groupLabel}
            </h3>
            {groupRows.map((row) => {
              const draftId =
                draftCategoryByCode[row.requestedProjectCode] ?? "";
              const displayCategory =
                row.status === "mapped" && row.knowledgeCategoryName
                  ? row.knowledgeCategoryName
                  : row.status === "category_inactive" && row.knowledgeCategoryName
                    ? row.knowledgeCategoryName
                    : null;
              const saving = savingCode === row.requestedProjectCode;
              const canSave =
                Boolean(draftId) &&
                (row.status === "unmapped" ||
                  row.status === "mapping_inactive" ||
                  row.status === "category_inactive" ||
                  (row.status === "mapped" &&
                    draftId !== row.knowledgeCategoryId));
              return (
                <Card
                  key={row.requestedProjectCode}
                  className="p-3 sm:p-4"
                  data-business-mapping-row={row.requestedProjectCode}
                >
                  <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-medium crm-text">
                        {row.requestedProjectLabel}
                      </p>
                      {displayCategory && row.status === "mapped" ? (
                        <p className="mt-0.5 text-xs crm-text-secondary sm:hidden">
                          {displayCategory}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      {row.status === "category_inactive" && displayCategory ? (
                        <p className="text-xs text-amber-800">
                          {displayCategory}{" "}
                          <span className="text-amber-900">
                            ({t("knowledge.categories.businessMappingStatusCategoryInactive")})
                          </span>
                        </p>
                      ) : null}
                      <select
                        value={draftId}
                        onChange={(event) =>
                          setDraftCategoryByCode((current) => ({
                            ...current,
                            [row.requestedProjectCode]: event.target.value,
                          }))
                        }
                        className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        data-business-mapping-category-select="true"
                      >
                        <option value="">
                          {t("knowledge.categories.businessMappingSelectCategory")}
                        </option>
                        {activeCategories
                          .filter((category) => category.isActive)
                          .map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          row.status === "mapped" ? "accent" : "warning"
                        }
                        className="text-xs"
                        data-business-mapping-status={row.status}
                      >
                        {t(statusLabelKey(row.status))}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!canSave || saving}
                        onClick={() => void saveMapping(row)}
                        data-business-mapping-save="true"
                      >
                        {saving
                          ? t("knowledge.categories.businessMappingSaving")
                          : t("knowledge.categories.businessMappingSave")}
                      </Button>
                      {row.mappingId && row.mappingActive ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={saving}
                          onClick={() => void deactivateMapping(row)}
                          data-business-mapping-deactivate="true"
                        >
                          {saving
                            ? t("knowledge.categories.businessMappingDeactivating")
                            : t("knowledge.categories.businessMappingDeactivate")}
                        </Button>
                      ) : null}
                      {successCode === row.requestedProjectCode ? (
                        <span className="text-xs text-emerald-700">
                          {row.mappingActive && canSave === false
                            ? t("knowledge.categories.businessMappingSaved")
                            : t("knowledge.categories.businessMappingSaved")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
