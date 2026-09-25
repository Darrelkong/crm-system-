"use client";

import { useCallback, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { Card } from "@/components/ui/card";
import type { KnowledgeCategoryListItem } from "@/lib/knowledge/core-service";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";
import type { OrganizerDraftFields } from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import { getRequestedProjectItem } from "@/lib/constants/requested-projects";
import { RequestedProjectSelector } from "@/components/customers/requested-project-selector";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";
import { evidencePreviewForCandidate } from "@/components/knowledge/knowledge-segment-candidate-cards";

export function KnowledgeSegmentCandidateCard({
  sourceId,
  candidate,
  categories,
  locale,
  onUpdated,
}: {
  sourceId: string;
  candidate: KnowledgeSegmentCandidateDetail;
  categories: KnowledgeCategoryListItem[];
  locale: "zh-Hans" | "zh-Hant" | "en";
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [organizing, setOrganizing] = useState(false);
  const [organizeError, setOrganizeError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<OrganizerDraftFields | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");

  const businessLabel =
    getRequestedProjectItem(candidate.requestedProjectCode)?.canonicalZhHans ??
    t("knowledge.ingest.businessCategoryPlaceholder");

  const loadDraft = useCallback(async () => {
    const response = await fetch(
      `/api/knowledge/sources/${sourceId}/candidates/${candidate.id}/organizer-draft`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const payload = (await response.json()) as {
      draft?: OrganizerDraftFields;
      error?: string;
      errorCode?: string;
    };
    if (!response.ok || !payload.draft) {
      throw new Error(
        resolveKnowledgeApiError(
          t,
          payload,
          "knowledge.ingest.smartIngestCandidateOrganizeFailed",
        ),
      );
    }
    setDraft(payload.draft);
    if (payload.draft.title) setTitle(payload.draft.title);
    if (payload.draft.summary) setSummary(payload.draft.summary);
    if (payload.draft.body) setBody(payload.draft.body);
    onUpdated();
  }, [candidate.id, onUpdated, sourceId, t]);

  async function organizeCandidate() {
    setOrganizing(true);
    setOrganizeError(null);
    try {
      const response = await fetch(
        `/api/knowledge/sources/${sourceId}/candidates/${candidate.id}/organize`,
        { method: "POST" },
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
            "knowledge.ingest.smartIngestCandidateOrganizeFailed",
          ),
        );
      }
      await loadDraft();
      setExpanded(true);
    } catch (caught) {
      setOrganizeError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.ingest.smartIngestCandidateOrganizeFailed"),
      );
    } finally {
      setOrganizing(false);
    }
  }

  const organized =
    candidate.organizationCompleted || Boolean(draft?.title && draft?.body);

  const categoryName =
    categories.find(
      (c) =>
        c.id ===
        (draft?.categoryId ||
          candidate.knowledgeCategoryId ||
          draft?.suggestedCategoryId),
    )?.name ?? "";

  return (
    <Card
      className="border-slate-200 bg-white p-4"
      data-candidate-card="true"
      data-candidate-id={candidate.id}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {t("knowledge.ingest.segmentNumber", {
          index: String(candidate.segmentIndex + 1),
        })}
      </p>
      <p className="mt-1 text-base font-semibold crm-text">
        {candidate.segmentTitleHint}
      </p>

      <div className="mt-3 space-y-2 text-sm">
        <p className="font-medium crm-text">
          {t("knowledge.ingest.businessCategory")}
        </p>
        <RequestedProjectSelector
          locale={locale}
          valueCode={candidate.requestedProjectCode}
          valueName={businessLabel}
          placeholder={t("knowledge.ingest.businessCategoryPlaceholder")}
          selectServiceTitle={t("customers.requestedProjectSelectService")}
          selectCountryTitle={t("customers.requestedProjectSelectCountry")}
          searchPlaceholder={t("customers.requestedProjectSearchPlaceholder")}
          backLabel={t("common.back")}
          closeLabel={t("common.close")}
          onSelect={({ code }) => {
            void fetch(
              `/api/knowledge/sources/${sourceId}/candidates/${candidate.id}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestedProjectCode: code }),
              },
            ).then(() => onUpdated());
          }}
        />
      </div>

      <div className="mt-3 space-y-2 text-sm" data-candidate-category="true">
        <p className="font-medium crm-text">
          {t("knowledge.ingest.knowledgeLibraryCategory")}
        </p>
        {candidate.categoryResolutionSource === "explicit_mapping" ? (
          <Badge variant="accent" data-category-state-badge="explicit_mapping">
            {t("knowledge.ingest.categoryAutoMatched")}
          </Badge>
        ) : null}
        {draft?.categoryResolutionSource === "ai_suggestion" ? (
          <Badge variant="accent" data-category-state-badge="ai_suggestion">
            {t("knowledge.ingest.categoryAiSuggested")}
          </Badge>
        ) : null}
        {!candidate.knowledgeCategoryId &&
        !draft?.categoryId &&
        !organized &&
        candidate.categoryResolutionSource !== "explicit_mapping" ? (
          <p className="text-xs crm-text-secondary">
            {t("knowledge.ingest.smartIngestCategoryAfterOrganize")}
          </p>
        ) : null}
        {categoryName ? (
          <p className="text-sm crm-text">{categoryName}</p>
        ) : null}
        <select
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          value={candidate.knowledgeCategoryId ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            void fetch(
              `/api/knowledge/sources/${sourceId}/candidates/${candidate.id}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  knowledgeCategoryId: value || null,
                }),
              },
            ).then(() => onUpdated());
          }}
        >
          <option value="">{t("knowledge.ingest.noCategory")}</option>
          {categories
            .filter((category) => category.isActive)
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </select>
        {draft?.categoryAiRequiresConfirmation && draft.suggestedCategoryId ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-adopt-category-suggestion="true"
            onClick={() => {
              void fetch(
                `/api/knowledge/sources/${sourceId}/candidates/${candidate.id}/organizer-draft`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ adoptCategorySuggestion: true }),
                },
              ).then(() => loadDraft());
            }}
          >
            {t("knowledge.ingest.adoptCategorySuggestion")}
          </Button>
        ) : null}
      </div>

      <p className="mt-3 text-xs font-medium crm-text-secondary">
        {t("knowledge.ingest.smartIngestCandidateEvidencePreview")}
      </p>
      <pre
        className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 crm-text"
        data-candidate-evidence-preview="true"
      >
        {evidencePreviewForCandidate(candidate.segmentEvidenceText)}
      </pre>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={organizing}
          data-candidate-organize-button="true"
          onClick={() => void organizeCandidate()}
        >
          {organizing
            ? t("knowledge.ingest.smartIngestCandidateOrganizing")
            : organized
              ? t("knowledge.ingest.smartIngestCandidateReorganize")
              : t("knowledge.ingest.smartIngestCandidateOrganizeIndependently")}
        </Button>
        {organized ? (
          <span
            className="self-center text-xs font-medium text-emerald-700"
            data-candidate-organized-label="true"
          >
            {t("knowledge.ingest.smartIngestCandidateOrganized")}
          </span>
        ) : null}
      </div>
      {organizeError ? (
        <p className="mt-2 text-sm text-rose-700" data-candidate-organize-error="true">
          {organizeError}
        </p>
      ) : null}

      {organized ? (
        <div className="mt-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-sm font-medium crm-text"
            onClick={() => setExpanded((value) => !value)}
            data-candidate-organized-toggle="true"
          >
            {t("knowledge.ingest.smartIngestCandidateOrganizedOutput")}
            {expanded ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          {expanded ? (
            <div className="mt-3 space-y-2 text-sm" data-candidate-organized-fields="true">
              <label className="block font-medium">
                {t("knowledge.ingest.title")}
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                  value={title || draft?.title || ""}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="block font-medium">
                {t("knowledge.ingest.summary")}
                <textarea
                  className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 p-3"
                  value={summary || draft?.summary || ""}
                  onChange={(e) => setSummary(e.target.value)}
                />
              </label>
              <label className="block font-medium">
                {t("knowledge.ingest.body")}
                <textarea
                  className="mt-1 min-h-32 w-full rounded-xl border border-slate-200 p-3"
                  value={body || draft?.body || ""}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              {(draft?.categorySelectionRequired ||
                draft?.categoryAiRequiresConfirmation) &&
              !draft.categoryId ? (
                <p className="text-xs text-amber-800">
                  {t("knowledge.ingest.categorySelectionRequired")}
                </p>
              ) : null}
              <p className="text-xs crm-text-secondary">
                {t("knowledge.ingest.smartIngestCandidateCompareNextStep")}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
