"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import type { KnowledgeCategoryListItem } from "@/lib/knowledge/core-service";
import type {
  KnowledgeSourceDetail,
  KnowledgeSourceListItem,
} from "@/lib/knowledge/source-service";
import {
  getKnowledgeErrorMessage,
  KnowledgeApiClientError,
  resolveKnowledgeApiError,
} from "@/lib/knowledge/error-messages";
import {
  createKnowledgeIngestLifecycleRequestGuard,
  fetchKnowledgeSourcesForLifecycle,
  isKnowledgeIngestLifecycleAbortError,
} from "@/lib/knowledge/knowledge-ingest-lifecycle";
import { KnowledgeComparisonSourceSection } from "@/components/knowledge/knowledge-comparison-source-section";
import { KnowledgeSourceArchiveButton } from "@/components/knowledge/knowledge-source-archive-button";
import { KnowledgeSourceRestoreButton } from "@/components/knowledge/knowledge-source-restore-button";
import type { KnowledgeSourceLifecycle } from "@/lib/knowledge/source-service";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import {
  buildFileSourceMetaLine,
  formatFileTypeLabel,
  formatSelectedFileSize,
  isExtractionFailureStatus,
  isFileUploadSource,
  isScannedPdfFailure,
} from "@/lib/knowledge/knowledge-ingest-upload-ui";

type KnowledgeSourceDuplicateNotice = {
  id: string;
  sourceTitle: string | null;
  originalFilename: string | null;
  lifecycle: "active" | "archived";
};

function statusLabel(
  t: (key: string, params?: Record<string, string>) => string,
  status: KnowledgeSourceListItem["status"],
) {
  return t(`knowledge.ingest.sourceStatuses.${status}`);
}

function sourceListStatusLabel(
  t: (key: string, params?: Record<string, string>) => string,
  source: KnowledgeSourceListItem,
): string {
  if (isScannedPdfFailure(source.failureCode)) {
    return t("knowledge.ingest.scannedPdfListLabel");
  }
  if (isExtractionFailureStatus(source.status)) {
    return t("knowledge.ingest.extractionFailedListLabel");
  }
  return statusLabel(t, source.status);
}

export function KnowledgeIngestClient({
  initialCategories,
  initialSources,
  role,
  userId,
  previewFixturesEnabled = false,
}: {
  initialCategories: KnowledgeCategoryListItem[];
  initialSources: KnowledgeSourceListItem[];
  role: KnowledgeRole | null;
  userId: string;
  previewFixturesEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<"paste" | "file">("paste");
  const [sourceTitle, setSourceTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [lifecycle, setLifecycle] = useState<KnowledgeSourceLifecycle>("active");
  const [sources, setSources] = useState(initialSources);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const lifecycleAbortRef = useRef<AbortController | null>(null);
  const lifecycleRequestGuardRef = useRef(createKnowledgeIngestLifecycleRequestGuard());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceListRef = useRef<HTMLDivElement>(null);
  const sourceButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [selected, setSelected] = useState<KnowledgeSourceDetail | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<
    "idle" | "uploading" | "reading"
  >("idle");
  const [duplicateNotice, setDuplicateNotice] =
    useState<KnowledgeSourceDuplicateNotice | null>(null);
  const [saved, setSaved] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [highlightedSourceId, setHighlightedSourceId] = useState<string | null>(
    null,
  );
  const [autoCompareSignal, setAutoCompareSignal] = useState(0);
  const organizerFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!highlightedSourceId) return;
    const timer = window.setTimeout(() => setHighlightedSourceId(null), 3200);
    return () => window.clearTimeout(timer);
  }, [highlightedSourceId]);

  useEffect(() => {
    if (!successToast) return;
    const timer = window.setTimeout(() => setSuccessToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [successToast]);

  function clearSelectedFile() {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function duplicateLabel(notice: KnowledgeSourceDuplicateNotice): string {
    return (
      notice.originalFilename ??
      notice.sourceTitle ??
      t("knowledge.ingest.sourcePreview")
    );
  }

  function extractionFailureMessage(failureCode: string | null): string {
    switch (failureCode) {
      case KNOWLEDGE_ERROR_CODES.SCANNED_PDF_UNSUPPORTED:
        return t("knowledge.ingest.scannedPdfNotice");
      case KNOWLEDGE_ERROR_CODES.PDF_PASSWORD_PROTECTED:
        return t("knowledge.ingest.passwordProtectedPdfNotice");
      case KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_TOO_LARGE:
        return t("knowledge.ingest.extractionTooLargeNotice");
      case KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_UNAVAILABLE:
        return t("knowledge.ingest.unsupportedExtraction");
      default:
        return t("knowledge.ingest.documentExtractionFailed");
    }
  }

  function applyOrganization(source: KnowledgeSourceDetail) {
    const organization = source.organization;
    if (!organization || organization.status !== "completed") return;
    setTitle(organization.proposedTitle ?? "");
    setSummary(organization.proposedSummary ?? "");
    setBody(organization.proposedBody ?? "");
    const suggested = organization.proposedCategory?.toLocaleLowerCase();
    const match = initialCategories.find(
      (category) =>
        category.name.toLocaleLowerCase() === suggested ||
        category.slug.toLocaleLowerCase() === suggested,
    );
    setCategoryId(match?.id ?? "");
  }

  const loadSourcesForLifecycle = useCallback(
    async (nextLifecycle: KnowledgeSourceLifecycle) => {
      lifecycleAbortRef.current?.abort();
      const requestId = lifecycleRequestGuardRef.current.begin();
      const controller = new AbortController();
      lifecycleAbortRef.current = controller;

      setSourcesLoading(true);
      setSources([]);

      try {
        const nextSources = await fetchKnowledgeSourcesForLifecycle(
          nextLifecycle,
          controller.signal,
        );
        if (!lifecycleRequestGuardRef.current.isCurrent(requestId)) return;
        setSources(nextSources);
      } catch (caught) {
        if (!lifecycleRequestGuardRef.current.isCurrent(requestId)) return;
        if (isKnowledgeIngestLifecycleAbortError(caught)) return;
        setSources([]);
        setError(
          caught instanceof KnowledgeApiClientError
            ? getKnowledgeErrorMessage(t, caught.errorCode)
            : t("knowledge.ingest.failure"),
        );
      } finally {
        if (lifecycleRequestGuardRef.current.isCurrent(requestId)) {
          setSourcesLoading(false);
          if (lifecycleAbortRef.current === controller) {
            lifecycleAbortRef.current = null;
          }
        }
      }
    },
    [t],
  );

  const switchLifecycle = useCallback(
    (nextLifecycle: KnowledgeSourceLifecycle) => {
      setLifecycle(nextLifecycle);
      setSelected(null);
      setSaved(false);
      setRestoreNotice(null);
      setError(null);
      void loadSourcesForLifecycle(nextLifecycle);
    },
    [loadSourcesForLifecycle],
  );

  async function loadSource(sourceId: string) {
    setError(null);
    const response = await fetch(`/api/knowledge/sources/${sourceId}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      source?: KnowledgeSourceDetail;
      error?: string;
      errorCode?: string;
    };
    if (!response.ok || !payload.source) {
      throw new Error(resolveKnowledgeApiError(t, payload, "knowledge.ingest.failure"));
    }
    setSelected(payload.source);
    applyOrganization(payload.source);
    setSaved(false);
  }

  async function createSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDuplicateNotice(null);
    setSaved(false);
    if (tab === "file") {
      setUploadPhase("uploading");
    }
    try {
      let response: Response;
      if (tab === "file") {
        if (!file) throw new Error(t("knowledge.ingest.chooseFile"));
        const form = new FormData();
        form.set("file", file);
        setUploadPhase("reading");
        response = await fetch("/api/knowledge/sources", {
          method: "POST",
          body: form,
        });
      } else {
        response = await fetch("/api/knowledge/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceTitle, rawText }),
        });
      }
      const payload = (await response.json()) as {
        source?: KnowledgeSourceDetail;
        error?: string;
        errorCode?: string;
        duplicate?: KnowledgeSourceDuplicateNotice;
      };
      if (
        !response.ok &&
        payload.errorCode === KNOWLEDGE_ERROR_CODES.SOURCE_DUPLICATE &&
        payload.duplicate
      ) {
        setDuplicateNotice(payload.duplicate);
        setSelected(null);
        return;
      }
      if (!response.ok || !payload.source) {
        throw new Error(resolveKnowledgeApiError(t, payload, "knowledge.ingest.failure"));
      }
      const createdSource = payload.source;
      setSources((current) => [createdSource, ...current]);
      setSourceTitle("");
      setRawText("");
      if (tab === "file") {
        clearSelectedFile();
        setSelected(null);
        setSuccessToast(t("knowledge.ingest.sourceCreatedSuccess"));
        setHighlightedSourceId(createdSource.id);
        window.requestAnimationFrame(() => {
          sourceButtonRefs.current
            .get(createdSource.id)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      } else {
        setSelected(createdSource);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    } finally {
      setBusy(false);
      setUploadPhase("idle");
    }
  }

  async function openDuplicateSource(
    sourceId: string,
    duplicateLifecycle: "active" | "archived",
  ) {
    setDuplicateNotice(null);
    setError(null);
    if (duplicateLifecycle === "archived") {
      if (lifecycle !== "archived") {
        switchLifecycle("archived");
      }
    } else if (lifecycle !== "active") {
      switchLifecycle("active");
    }
    try {
      await loadSource(sourceId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    }
  }

  async function organize() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/knowledge/sources/${selected.id}/organize`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        source?: KnowledgeSourceDetail;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.source) {
        throw new Error(resolveKnowledgeApiError(t, payload, "knowledge.ingest.failure"));
      }
      setSelected(payload.source);
      applyOrganization(payload.source);
      setSources((current) =>
        current.map((source) =>
          source.id === payload.source!.id ? payload.source! : source,
        ),
      );
      if (payload.source.organization?.status === "completed") {
        setAutoCompareSignal((current) => current + 1);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(
        `/api/knowledge/sources/${selected.id}/convert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            summary,
            body,
            categoryId,
            visibility: "team",
            changeNote: t("knowledge.article.ingestChangeNote"),
          }),
        },
      );
      const payload = (await response.json()) as {
        article?: { id: string };
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.article) {
        throw new Error(resolveKnowledgeApiError(t, payload, "knowledge.ingest.failure"));
      }
      setSaved(true);
      router.push(`/knowledge/articles/${payload.article.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    } finally {
      setBusy(false);
    }
  }

  const canIngest =
    role === "contributor" ||
    role === "knowledge_admin";
  const organizationReady = selected?.organization?.status === "completed";
  const isArchivedView = lifecycle === "archived";
  const selectedArchived = Boolean(selected?.archivedAt);

  if (!canIngest) {
    return (
      <Card>
        <p className="crm-text-secondary">{t("common.insufficientPermission")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-amber-200 bg-amber-50">
        <p className="text-sm leading-6 text-amber-950">{t("knowledge.ingest.notice")}</p>
      </Card>
      {restoreNotice && (
        <Card className="border-emerald-200 bg-emerald-50">
          <p className="text-sm leading-6 text-emerald-950">{restoreNotice}</p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="font-semibold crm-text">{t("knowledge.ingest.sourceList")}</h2>
            <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1">
              <button
                type="button"
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                  lifecycle === "active"
                    ? "bg-blue-50 font-medium text-blue-700"
                    : "border border-slate-200 bg-white crm-text-secondary"
                }`}
                onClick={() => void switchLifecycle("active")}
              >
                {t("knowledge.ingest.lifecycleActive")}
              </button>
              <button
                type="button"
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                  lifecycle === "archived"
                    ? "bg-blue-50 font-medium text-blue-700"
                    : "border border-slate-200 bg-white crm-text-secondary"
                }`}
                onClick={() => void switchLifecycle("archived")}
              >
                {t("knowledge.ingest.lifecycleArchived")}
              </button>
            </div>
            <div
              ref={sourceListRef}
              className="mt-3 space-y-2"
              data-lifecycle-list="true"
            >
              {sourcesLoading ? (
                <div className="space-y-2" aria-busy="true" data-lifecycle-loading="true">
                  <p className="text-sm crm-text-secondary">{t("common.loading")}</p>
                  <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                </div>
              ) : sources.length === 0 ? (
                <p className="text-sm crm-text-secondary">
                  {isArchivedView
                    ? t("knowledge.ingest.noArchivedSources")
                    : t("knowledge.ingest.noSources")}
                </p>
              ) : (
                sources.map((source) => {
                  const fileMeta = isFileUploadSource(source)
                    ? buildFileSourceMetaLine(
                        source.mimeType,
                        source.originalFilename,
                        source.sizeBytes,
                      )
                    : null;
                  const listTitle = isFileUploadSource(source)
                    ? (source.originalFilename ??
                      source.sourceTitle ??
                      source.id.slice(0, 8))
                    : (source.sourceTitle ?? t("knowledge.ingest.textSourceLabel"));
                  const isHighlighted = highlightedSourceId === source.id;
                  const statusTone =
                    isScannedPdfFailure(source.failureCode) ||
                    isExtractionFailureStatus(source.status)
                      ? "warning"
                      : "default";

                  return (
                    <button
                      key={source.id}
                      ref={(node) => {
                        if (node) {
                          sourceButtonRefs.current.set(source.id, node);
                        } else {
                          sourceButtonRefs.current.delete(source.id);
                        }
                      }}
                      type="button"
                      onClick={() => void loadSource(source.id)}
                      data-source-id={source.id}
                      className={`w-full min-w-0 rounded-xl border p-3 text-left transition-colors ${
                        isHighlighted
                          ? "border-blue-300 bg-blue-50 ring-2 ring-blue-200"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <span className="block min-w-0 truncate text-sm font-medium crm-text">
                          {listTitle}
                        </span>
                        <Badge
                          variant={statusTone === "warning" ? "warning" : "accent"}
                          className="shrink-0"
                        >
                          {sourceListStatusLabel(t, source)}
                        </Badge>
                      </div>
                      <span className="mt-1 block truncate text-xs crm-text-secondary">
                        {fileMeta ?? t("knowledge.ingest.textSourceLabel")}
                      </span>
                      <span className="mt-1 block text-xs crm-text-secondary">
                        {new Date(source.createdAt).toLocaleDateString()}
                        {source.archivedAt
                          ? ` · ${t("knowledge.ingest.archivedBadge")}`
                          : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </Card>
        </aside>

        <main className="min-w-0 space-y-4">
          {!isArchivedView && (
          <Card>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={tab === "paste" ? "primary" : "secondary"}
                onClick={() => setTab("paste")}
              >
                {t("knowledge.ingest.pasteTab")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={tab === "file" ? "primary" : "secondary"}
                onClick={() => setTab("file")}
              >
                {t("knowledge.ingest.fileTab")}
              </Button>
            </div>
            <form className="mt-5 space-y-4" onSubmit={createSource}>
              {tab === "paste" ? (
                <>
                  <label className="block text-sm font-medium crm-text">
                    {t("knowledge.ingest.sourceTitle")}
                    <input
                      value={sourceTitle}
                      onChange={(event) => setSourceTitle(event.target.value)}
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                      maxLength={200}
                    />
                  </label>
                  <label className="block text-sm font-medium crm-text">
                    {t("knowledge.ingest.rawText")}
                    <textarea
                      required
                      value={rawText}
                      onChange={(event) => setRawText(event.target.value)}
                      className="mt-1 min-h-48 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"
                      maxLength={100_000}
                    />
                  </label>
                </>
              ) : (
                <div className="min-w-0 space-y-4" data-upload-panel="true">
                  <input
                    ref={fileInputRef}
                    id="knowledge-ingest-file-input"
                    type="file"
                    accept=".txt,.md,.pdf,.docx"
                    onChange={(event) => {
                      setDuplicateNotice(null);
                      setFile(event.target.files?.[0] ?? null);
                    }}
                    className="sr-only"
                    aria-label={t("knowledge.ingest.chooseFileButton")}
                  />
                  {!file ? (
                    <div
                      className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/90 px-4 py-8 text-center"
                      data-upload-empty="true"
                    >
                      <Upload
                        className="mx-auto h-10 w-10 text-slate-400"
                        aria-hidden
                      />
                      <h3 className="mt-4 text-base font-semibold crm-text">
                        {t("knowledge.ingest.uploadEmptyTitle")}
                      </h3>
                      <p className="mt-2 text-sm leading-6 crm-text-secondary">
                        {t("knowledge.ingest.uploadEmptySubtitle")}
                      </p>
                      <p className="mt-3 text-xs leading-5 crm-text-secondary">
                        {t("knowledge.ingest.uploadFormatsLine")}
                      </p>
                      <div className="mt-5">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {t("knowledge.ingest.chooseFileButton")}
                        </Button>
                      </div>
                      {previewFixturesEnabled && (
                        <p className="mt-5 text-sm">
                          <Link
                            href="/local-preview/knowledge-fixtures"
                            className="text-blue-700 underline"
                            data-preview-fixtures-link="true"
                          >
                            {t("knowledge.ingest.getTestFixtures")}
                          </Link>
                        </p>
                      )}
                    </div>
                  ) : (
                    <div
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                      data-upload-selected="true"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <FileText
                          className="mt-0.5 h-5 w-5 shrink-0 text-slate-500"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-sm font-medium crm-text"
                            data-selected-filename="true"
                          >
                            {file.name}
                          </p>
                          <p
                            className="mt-1 text-xs crm-text-secondary"
                            data-selected-meta="true"
                          >
                            {formatFileTypeLabel(file.name)} ·{" "}
                            {formatSelectedFileSize(file.size)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-4 border-t border-slate-100 pt-3">
                        <button
                          type="button"
                          className="text-sm font-medium text-blue-700"
                          data-replace-file="true"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {t("knowledge.ingest.replaceFile")}
                        </button>
                        <button
                          type="button"
                          className="text-sm font-medium crm-text-secondary"
                          data-remove-file="true"
                          onClick={clearSelectedFile}
                        >
                          {t("knowledge.ingest.removeFile")}
                        </button>
                      </div>
                    </div>
                  )}
                  {(uploadPhase === "uploading" || uploadPhase === "reading") && (
                    <div
                      className="flex min-w-0 items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-blue-900"
                      data-upload-phase={uploadPhase}
                      aria-live="polite"
                    >
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      <span>
                        {uploadPhase === "uploading"
                          ? t("knowledge.ingest.uploadingFile")
                          : t("knowledge.ingest.readingFileContent")}
                      </span>
                    </div>
                  )}
                  {duplicateNotice && (
                    <div
                      className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
                      data-duplicate-notice="true"
                    >
                      <h3 className="text-sm font-semibold text-amber-950">
                        {t("knowledge.ingest.duplicateDetected")}
                      </h3>
                      <p className="mt-2 text-sm text-amber-900">
                        {duplicateNotice.lifecycle === "archived"
                          ? t("knowledge.ingest.duplicateArchivedMessage", {
                              label: duplicateLabel(duplicateNotice),
                            })
                          : t("knowledge.ingest.duplicateActiveMessage", {
                              label: duplicateLabel(duplicateNotice),
                            })}
                      </p>
                      <div className="mt-4">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            void openDuplicateSource(
                              duplicateNotice.id,
                              duplicateNotice.lifecycle,
                            )
                          }
                        >
                          {duplicateNotice.lifecycle === "archived"
                            ? t("knowledge.ingest.goToArchivedSources")
                            : t("knowledge.ingest.viewExistingSource")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <Button
                type="submit"
                disabled={busy || (tab === "file" && !file)}
                className="w-full sm:w-auto"
              >
                {busy
                  ? t("knowledge.ingest.creatingSource")
                  : t("knowledge.ingest.createSource")}
              </Button>
            </form>
          </Card>
          )}

          {selected && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold crm-text">
                    {t("knowledge.ingest.sourcePreview")}
                  </h2>
                  <p className="mt-1 text-sm crm-text-secondary">
                    {selected.originalFilename ?? selected.sourceTitle ?? selected.sourceType}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      isScannedPdfFailure(selected.failureCode) ||
                      isExtractionFailureStatus(selected.status)
                        ? "warning"
                        : selected.status === "failed"
                          ? "danger"
                          : "accent"
                    }
                  >
                    {sourceListStatusLabel(t, selected)}
                  </Badge>
                  {selectedArchived && (
                    <Badge>{t("knowledge.ingest.archivedBadge")}</Badge>
                  )}
                </div>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="crm-text-secondary">{t("knowledge.ingest.sourceType")}</dt>
                  <dd className="crm-text">{selected.sourceType}</dd>
                </div>
                <div>
                  <dt className="crm-text-secondary">{t("knowledge.ingest.extraction")}</dt>
                  <dd className="crm-text">
                    {selected.rawText
                      ? t("knowledge.ingest.extractionReady")
                      : t("knowledge.ingest.extractionFailed")}
                  </dd>
                </div>
                <div>
                  <dt className="crm-text-secondary">{t("common.createdAt")}</dt>
                  <dd className="crm-text">
                    {new Date(selected.createdAt).toLocaleString()}
                  </dd>
                </div>
              </dl>
              {selected.rawText ? (
                <pre className="mt-5 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-6 crm-text">
                  {selected.rawText}
                </pre>
              ) : (
                <div
                  className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4"
                  data-extraction-notice="true"
                >
                  <p className="text-sm font-medium text-amber-950">
                    {isScannedPdfFailure(selected.failureCode)
                      ? t("knowledge.ingest.scannedPdfListLabel")
                      : t("knowledge.ingest.extractionFailedListLabel")}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-amber-900">
                    {extractionFailureMessage(selected.failureCode)}
                  </p>
                </div>
              )}
              {selected.rawText &&
                !selectedArchived &&
                selected.status !== "converted" &&
                !organizationReady && (
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      onClick={() => void organize()}
                      disabled={busy || selected.status === "organizing"}
                    >
                      {busy
                        ? t("knowledge.ingest.organizing")
                        : t("knowledge.ingest.organize")}
                    </Button>
                    <KnowledgeSourceArchiveButton
                      sourceId={selected.id}
                      updatedAt={selected.updatedAt}
                      onArchived={() => {
                        switchLifecycle("active");
                        router.refresh();
                      }}
                    />
                  </div>
                )}
              {selectedArchived && (
                <div className="mt-5 space-y-3">
                  <p className="text-sm crm-text-secondary">
                    {t("knowledge.ingest.archivedReadOnly")}
                  </p>
                  <KnowledgeSourceRestoreButton
                    sourceId={selected.id}
                    updatedAt={selected.updatedAt}
                    onRestored={() => {
                      setRestoreNotice(t("knowledge.ingest.restoreSuccess"));
                      switchLifecycle("active");
                      router.refresh();
                    }}
                  />
                </div>
              )}
              {!selectedArchived &&
                selected.status !== "organizing" &&
                !(selected.rawText && selected.status !== "converted" && !organizationReady) && (
                  <div className="mt-5">
                    <KnowledgeSourceArchiveButton
                      sourceId={selected.id}
                      updatedAt={selected.updatedAt}
                      onArchived={() => {
                        switchLifecycle("active");
                        router.refresh();
                      }}
                    />
                  </div>
                )}
            </Card>
          )}

          {organizationReady && selected && !selectedArchived && (
            <Card>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="font-semibold text-blue-950">
                  {t("knowledge.ingest.aiLabel")}
                </p>
                <p className="mt-1 text-sm text-blue-900">
                  {t("knowledge.ingest.warning")}
                </p>
              </div>
              {selected.organization?.warnings.map((warning) => (
                <p key={warning} className="mt-3 text-sm text-amber-700">
                  ⚠ {warning}
                </p>
              ))}
              <KnowledgeComparisonSourceSection
                sourceId={selected.id}
                sourceCreatedByUserId={selected.createdByUserId}
                sourceStatus={selected.status}
                organizationReady={organizationReady}
                role={role}
                userId={userId}
                autoCompareSignal={autoCompareSignal}
                onCreateDraft={() => {
                  organizerFormRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }}
                className="mt-5"
              />
              <form
                ref={organizerFormRef}
                className="mt-5 space-y-4"
                onSubmit={saveDraft}
              >
                <label className="block text-sm font-medium crm-text">
                  {t("knowledge.ingest.title")}
                  <input
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                  />
                </label>
                <label className="block text-sm font-medium crm-text">
                  {t("knowledge.ingest.summary")}
                  <textarea
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                    className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 bg-white p-3"
                  />
                </label>
                <label className="block text-sm font-medium crm-text">
                  {t("knowledge.ingest.body")}
                  <textarea
                    required
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    className="mt-1 min-h-64 w-full rounded-xl border border-slate-200 bg-white p-3"
                  />
                </label>
                <label className="block text-sm font-medium crm-text">
                  {t("knowledge.ingest.category")}
                  <select
                    required
                    value={categoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                  >
                    <option value="">{t("knowledge.ingest.noCategory")}</option>
                    {initialCategories
                      .filter((category) => category.isActive)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                </label>
                <Button type="submit" disabled={busy || selected.status === "converted"}>
                  {busy
                    ? t("knowledge.ingest.savingDraft")
                    : saved
                      ? t("knowledge.ingest.savedDraft")
                      : t("knowledge.ingest.saveDraft")}
                </Button>
              </form>
            </Card>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
              {error}
            </p>
          )}
          {!selected && !sourcesLoading && sources.length === 0 && (
            <EmptyState
              message={
                isArchivedView
                  ? t("knowledge.ingest.noArchivedSources")
                  : t("knowledge.ingest.noSources")
              }
            />
          )}
        </main>
      </div>
      {successToast && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4"
          role="status"
          aria-live="polite"
          data-upload-success-toast="true"
        >
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-950 shadow-md">
            {successToast}
          </div>
        </div>
      )}
    </div>
  );
}
