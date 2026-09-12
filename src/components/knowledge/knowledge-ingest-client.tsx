"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
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
import { KnowledgeSourceArchiveButton } from "@/components/knowledge/knowledge-source-archive-button";
import { KnowledgeSourceRestoreButton } from "@/components/knowledge/knowledge-source-restore-button";
import type { KnowledgeSourceLifecycle } from "@/lib/knowledge/source-service";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";

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

function formatSelectedFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgeIngestClient({
  initialCategories,
  initialSources,
  role,
  previewFixturesEnabled = false,
}: {
  initialCategories: KnowledgeCategoryListItem[];
  initialSources: KnowledgeSourceListItem[];
  role: KnowledgeRole | null;
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
      setSources((current) => [payload.source!, ...current]);
      setSelected(payload.source);
      setSourceTitle("");
      setRawText("");
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
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
            <div className="mt-3 space-y-2" data-lifecycle-list="true">
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
                sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => void loadSource(source.id)}
                    className="w-full rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50"
                  >
                    <span className="block truncate text-sm font-medium crm-text">
                      {source.sourceTitle ?? source.originalFilename ?? source.id.slice(0, 8)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs crm-text-secondary">
                      <span>{statusLabel(t, source.status)}</span>
                      <span>·</span>
                      <span>{source.sourceType}</span>
                      <span>·</span>
                      <span>{new Date(source.createdAt).toLocaleDateString()}</span>
                      {source.archivedAt && (
                        <Badge>{t("knowledge.ingest.archivedBadge")}</Badge>
                      )}
                    </span>
                  </button>
                ))
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
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium crm-text">
                      {t("knowledge.ingest.chooseFile")}
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.pdf,.docx"
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                      className="sr-only"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {t("knowledge.ingest.chooseFileButton")}
                      </Button>
                      <span className="text-sm crm-text-secondary">
                        {file
                          ? t("knowledge.ingest.fileSelected")
                          : t("knowledge.ingest.noFileSelected")}
                      </span>
                    </div>
                    {file ? (
                      <div className="mt-3 flex min-w-0 items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <FileText
                          className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium crm-text">
                            {file.name}
                          </p>
                          <p className="mt-0.5 text-xs crm-text-secondary">
                            {formatSelectedFileSize(file.size)}
                          </p>
                        </div>
                      </div>
                    ) : null}
                    <p className="mt-2 text-xs leading-5 crm-text-secondary">
                      {t("knowledge.ingest.supportedFormats")}
                    </p>
                    <p className="text-xs crm-text-secondary">
                      {t("knowledge.ingest.maxFileSize")}
                    </p>
                  </div>
                  {previewFixturesEnabled && (
                    <p className="text-sm">
                      <Link
                        href="/local-preview/knowledge-fixtures"
                        className="text-blue-700 underline"
                      >
                        {t("knowledge.ingest.getTestFixtures")}
                      </Link>
                    </p>
                  )}
                </div>
              )}
              {tab === "file" && uploadPhase !== "idle" && (
                <p className="text-sm text-blue-900">
                  {uploadPhase === "uploading"
                    ? t("knowledge.ingest.uploading")
                    : t("knowledge.ingest.readingDocument")}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy
                  ? tab === "file"
                    ? uploadPhase === "reading"
                      ? t("knowledge.ingest.readingDocument")
                      : t("knowledge.ingest.uploading")
                    : t("knowledge.ingest.creatingSource")
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
                    variant={selected.status === "failed" ? "danger" : "accent"}
                  >
                    {statusLabel(t, selected.status)}
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
                <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
                  {extractionFailureMessage(selected.failureCode)}
                </p>
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
              <form className="mt-5 space-y-4" onSubmit={saveDraft}>
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

          {duplicateNotice && (
            <Card className="border-amber-200 bg-amber-50">
              <h2 className="text-base font-semibold text-amber-950">
                {t("knowledge.ingest.duplicateDetected")}
              </h2>
              <p className="mt-2 text-sm text-amber-900">
                {duplicateNotice.lifecycle === "archived"
                  ? t("knowledge.ingest.duplicateArchivedMessage", {
                      label: duplicateLabel(duplicateNotice),
                    })
                  : t("knowledge.ingest.duplicateActiveMessage", {
                      label: duplicateLabel(duplicateNotice),
                    })}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
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
    </div>
  );
}
