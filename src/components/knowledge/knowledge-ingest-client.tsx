"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronLeft, FileText, Loader2, Upload } from "lucide-react";
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
import { KnowledgeIngestStepHeader } from "@/components/knowledge/knowledge-ingest-step-header";
import { KnowledgeMobileSheet } from "@/components/knowledge/knowledge-mobile-sheet";
import { KnowledgeSourceArchiveButton } from "@/components/knowledge/knowledge-source-archive-button";
import { cn } from "@/lib/cn";
import { KnowledgeSourceRestoreButton } from "@/components/knowledge/knowledge-source-restore-button";
import type { KnowledgeSourceLifecycle } from "@/lib/knowledge/source-service";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import {
  buildFileSourceMetaLine,
  formatFileTypeLabel,
  formatSelectedFileSize,
  isExtractionFailureStatus,
  isFileUploadSource,
  isKnowledgeImageFilename,
  isScannedPdfFailure,
  visionExtractionAdvisoryKey,
} from "@/lib/knowledge/knowledge-ingest-upload-ui";
import { hasSubstantiveSourceEvidence } from "@/lib/knowledge/knowledge-extraction-usability";
import type { KnowledgeSourceDuplicateNotice } from "@/lib/knowledge/source-duplicate-resolution";
import {
  isVisionExtractionUsable,
  sourceBlocksOrganizeForVisionReview,
  sourceRequiresVisionHumanReview,
  visionExtractionReviewConfirmed,
} from "@/lib/knowledge/knowledge-vision-integrity";
import { KnowledgeSmartIngestAnalysisSection } from "@/components/knowledge/knowledge-smart-ingest-analysis-section";
import type { KnowledgeSourceAnalysisStatus } from "../../../drizzle/schema/knowledge-sources";
import { RequestedProjectSelector } from "@/components/customers/requested-project-selector";
import { getRequestedProjectItem } from "@/lib/constants/requested-projects";
import {
  emptyOrganizerDraft,
  type OrganizerDraftFields,
} from "@/lib/knowledge/knowledge-ingest-organizer-draft";

function canRetryVisionExtraction(source: KnowledgeSourceDetail): boolean {
  const unusableVision =
    source.extractionMethod === "vision" &&
    source.extractionMetadata?.integrityTrace?.extractionUsable === false;
  return (
    !source.archivedAt &&
    (source.status === "failed" || (source.status === "ready" && unusableVision)) &&
    source.sourceType === "file" &&
    Boolean(source.storageKey) &&
    Boolean(
      source.originalFilename &&
        isKnowledgeImageFilename(source.originalFilename),
    )
  );
}

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
  const { t, locale } = useTranslation();
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
  const sourceLoadRequestGuardRef = useRef(createKnowledgeIngestLifecycleRequestGuard());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceListRef = useRef<HTMLDivElement>(null);
  const sourceButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const detailHeaderRef = useRef<HTMLDivElement>(null);
  const createFormPanelRef = useRef<HTMLDivElement>(null);
  const [loadingSourceId, setLoadingSourceId] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [selected, setSelected] = useState<KnowledgeSourceDetail | null>(null);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [requestedProjectCode, setRequestedProjectCode] = useState<string | null>(
    null,
  );
  const [requestedProjectName, setRequestedProjectName] = useState("");
  const [categoryNotice, setCategoryNotice] = useState<
    "none" | "needs_confirmation" | "no_match"
  >("none");
  const [categoryResolutionSource, setCategoryResolutionSource] = useState<
    OrganizerDraftFields["categoryResolutionSource"]
  >(null);
  const manualRequestedProjectOverrideRef = useRef(false);
  const manualCategoryOverrideRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingSource, setCreatingSource] = useState(false);
  const createSubmitLockRef = useRef(false);
  const [uploadPhase, setUploadPhase] = useState<
    "idle" | "uploading" | "reading"
  >("idle");
  const [retryingExtraction, setRetryingExtraction] = useState(false);
  const [reviewDraftText, setReviewDraftText] = useState("");
  const [confirmingVisionReview, setConfirmingVisionReview] = useState(false);
  const [duplicateNotice, setDuplicateNotice] =
    useState<KnowledgeSourceDuplicateNotice | null>(null);
  const [saved, setSaved] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [highlightedSourceId, setHighlightedSourceId] = useState<string | null>(
    null,
  );
  const [autoCompareSignal, setAutoCompareSignal] = useState(0);
  const [smartIngestScopeLive, setSmartIngestScopeLive] = useState<
    KnowledgeSourceDetail["smartIngestScope"] | null
  >(null);
  const organizerFormRef = useRef<HTMLFormElement>(null);
  const analyzeSectionRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  function syncReviewDraftFromSource(source: KnowledgeSourceDetail | null) {
    setReviewDraftText(source?.rawText ?? "");
  }

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

  function duplicateNoticeTitle(notice: KnowledgeSourceDuplicateNotice): string {
    if (notice.lifecycle === "archived") {
      return t("knowledge.ingest.duplicateDetected");
    }
    switch (notice.case) {
      case "failed_extraction":
        return t("knowledge.ingest.duplicateFailedDetected");
      case "unusable":
      case "awaiting_review":
      case "completed":
        return t("knowledge.ingest.duplicateSameSourceDetected");
      default:
        return t("knowledge.ingest.duplicateDetected");
    }
  }

  function duplicateNoticeMessage(notice: KnowledgeSourceDuplicateNotice): string {
    const label = duplicateLabel(notice);
    if (notice.lifecycle === "archived") {
      return t("knowledge.ingest.duplicateArchivedMessage", { label });
    }
    switch (notice.case) {
      case "failed_extraction":
        return t("knowledge.ingest.duplicateFailedMessage", { label });
      case "unusable":
        return t("knowledge.ingest.duplicateUnusableMessage", { label });
      case "awaiting_review":
        return t("knowledge.ingest.duplicateAwaitingReviewMessage", { label });
      case "completed":
        return t("knowledge.ingest.duplicateCompletedMessage");
      default:
        return t("knowledge.ingest.duplicateActiveMessage", { label });
    }
  }

  async function reprocessDuplicateSource(
    notice: KnowledgeSourceDuplicateNotice,
    options?: { confirmReplaceCompleted?: boolean },
  ) {
    setDuplicateNotice(null);
    setRetryingExtraction(true);
    setBusy(true);
    setError(null);
    setHighlightedSourceId(notice.id);
    if (notice.lifecycle === "archived") {
      if (lifecycle !== "archived") {
        switchLifecycle("archived");
      }
    } else if (lifecycle !== "active") {
      switchLifecycle("active");
    }
    try {
      await loadSource(notice.id);
      await retryImageExtraction(notice.id, options);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    }
  }

  function handleReprocessDuplicate(notice: KnowledgeSourceDuplicateNotice) {
    if (notice.requiresReprocessConfirmation) {
      const confirmed = window.confirm(t("knowledge.ingest.reprocessCompletedConfirm"));
      if (!confirmed) return;
      void reprocessDuplicateSource(notice, { confirmReplaceCompleted: true });
      return;
    }
    void reprocessDuplicateSource(notice);
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
      case KNOWLEDGE_ERROR_CODES.IMAGE_UNSUPPORTED:
      case KNOWLEDGE_ERROR_CODES.IMAGE_INVALID:
      case KNOWLEDGE_ERROR_CODES.VISION_UNSUPPORTED:
      case KNOWLEDGE_ERROR_CODES.VISION_OUTPUT_INVALID:
      case KNOWLEDGE_ERROR_CODES.VISION_TIMEOUT:
        return t("knowledge.ingest.imageVisionFailed");
      case KNOWLEDGE_ERROR_CODES.IMAGE_TOO_LARGE:
        return t("knowledge.ingest.imageTooLarge");
      default:
        return t("knowledge.ingest.documentExtractionFailed");
    }
  }

  function clearOrganizerDraftFields(options?: { preserveKnowledgeCategory?: boolean }) {
    const empty = emptyOrganizerDraft();
    setTitle(empty.title);
    setSummary(empty.summary);
    setBody(empty.body);
    if (!options?.preserveKnowledgeCategory) {
      setCategoryId(empty.categoryId);
    }
    setRequestedProjectCode(empty.requestedProjectCode);
    setRequestedProjectName(empty.requestedProjectName);
    setCategoryNotice(empty.categoryNotice);
    setCategoryResolutionSource(empty.categoryResolutionSource);
  }

  function applyOrganizerDraft(draft: OrganizerDraftFields) {
    setTitle(draft.title);
    setSummary(draft.summary);
    setBody(draft.body);
    setRequestedProjectCode(draft.requestedProjectCode);
    setRequestedProjectName(draft.requestedProjectName);
    setCategoryId(draft.categoryId);
    setCategoryNotice(draft.categoryNotice);
    setCategoryResolutionSource(draft.categoryResolutionSource);
  }

  async function fetchOrganizerDraft(
    source: KnowledgeSourceDetail,
    overrides?: {
      manualRequestedProjectCode?: string | null;
      manualRequestedProjectOverride?: boolean;
      manualCategoryId?: string | null;
      manualCategoryOverride?: boolean;
    },
  ): Promise<OrganizerDraftFields | null> {
    const organization = source.organization;
    if (!organization || organization.status !== "completed") {
      clearOrganizerDraftFields();
      return null;
    }
    if (source.smartIngestScope.blocksSourceLevelOrganize) {
      clearOrganizerDraftFields();
      return null;
    }
    const response = await fetch(
      `/api/knowledge/sources/${source.id}/organizer-draft`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualRequestedProjectCode:
            overrides?.manualRequestedProjectCode ?? requestedProjectCode,
          manualRequestedProjectOverride:
            overrides?.manualRequestedProjectOverride ??
            manualRequestedProjectOverrideRef.current,
          manualCategoryId:
            overrides?.manualCategoryId ?? (categoryId ? categoryId : null),
          manualCategoryOverride:
            overrides?.manualCategoryOverride ??
            manualCategoryOverrideRef.current,
        }),
      },
    );
    const payload = (await response.json()) as {
      draft?: OrganizerDraftFields;
      error?: string;
      errorCode?: string;
    };
    if (!response.ok || !payload.draft) {
      throw new Error(
        resolveKnowledgeApiError(t, payload, "knowledge.ingest.failure"),
      );
    }
    return payload.draft;
  }

  async function applyOrganization(source: KnowledgeSourceDetail) {
    const draft = await fetchOrganizerDraft(source);
    if (draft) {
      applyOrganizerDraft(draft);
    }
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

  function switchLifecycle(nextLifecycle: KnowledgeSourceLifecycle) {
    setLifecycle(nextLifecycle);
    setSelected(null);
    setCreateFormOpen(false);
    setSaved(false);
    setRestoreNotice(null);
    setError(null);
    void loadSourcesForLifecycle(nextLifecycle);
  }

  function clearSelectedSource() {
    setSelected(null);
    setSaved(false);
    setError(null);
    manualRequestedProjectOverrideRef.current = false;
    manualCategoryOverrideRef.current = false;
    setSmartIngestScopeLive(null);
    clearOrganizerDraftFields();
  }

  function syncSourceAnalysisStatus(analysisStatus: KnowledgeSourceAnalysisStatus) {
    setSelected((current) =>
      current ? { ...current, analysisStatus } : current,
    );
    setSources((current) =>
      current.map((item) =>
        item.id === selected?.id ? { ...item, analysisStatus } : item,
      ),
    );
  }

  function scrollDetailIntoView() {
    window.requestAnimationFrame(() => {
      detailHeaderRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function openCreateSourcePanel() {
    setCreateFormOpen(true);
    if (!isMobileViewport) {
      window.requestAnimationFrame(() => {
        createFormPanelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }

  async function loadSource(sourceId: string) {
    if (loadingSourceId === sourceId) return;
    const requestId = sourceLoadRequestGuardRef.current.begin();
    setError(null);
    setCreateFormOpen(false);
    setLoadingSourceId(sourceId);
    manualRequestedProjectOverrideRef.current = false;
    manualCategoryOverrideRef.current = false;
    clearOrganizerDraftFields();
    try {
      const response = await fetch(`/api/knowledge/sources/${sourceId}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        source?: KnowledgeSourceDetail;
        error?: string;
        errorCode?: string;
      };
      if (!sourceLoadRequestGuardRef.current.isCurrent(requestId)) return;
      if (!response.ok || !payload.source) {
        throw new Error(
          resolveKnowledgeApiError(t, payload, "knowledge.ingest.failure"),
        );
      }
      setSelected(payload.source);
      setSmartIngestScopeLive(payload.source.smartIngestScope);
      syncReviewDraftFromSource(payload.source);
      if (payload.source.smartIngestScope.blocksSourceLevelOrganize) {
        clearOrganizerDraftFields();
      } else {
        await applyOrganization(payload.source);
      }
      setSaved(false);
      scrollDetailIntoView();
    } catch (caught) {
      if (!sourceLoadRequestGuardRef.current.isCurrent(requestId)) return;
      setError(
        caught instanceof Error ? caught.message : t("knowledge.ingest.failure"),
      );
    } finally {
      if (sourceLoadRequestGuardRef.current.isCurrent(requestId)) {
        setLoadingSourceId(null);
      }
    }
  }

  async function completePasteSourceTransition(sourceId: string, toastKey: string) {
    flushSync(() => {
      setCreateFormOpen(false);
      setSourceTitle("");
      setRawText("");
      setDuplicateNotice(null);
    });
    await loadSource(sourceId);
    setHighlightedSourceId(sourceId);
    setSuccessToast(t(toastKey));
  }

  async function createSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createSubmitLockRef.current) return;
    createSubmitLockRef.current = true;
    setCreatingSource(true);
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
        if (tab === "paste") {
          if (payload.duplicate.lifecycle === "archived") {
            if (lifecycle !== "archived") {
              switchLifecycle("archived");
            }
          } else if (lifecycle !== "active") {
            switchLifecycle("active");
          }
          await completePasteSourceTransition(
            payload.duplicate.id,
            "knowledge.ingest.pasteDuplicateOpenedExisting",
          );
          return;
        }
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
        manualRequestedProjectOverrideRef.current = false;
        manualCategoryOverrideRef.current = false;
        clearOrganizerDraftFields();
        await completePasteSourceTransition(
          createdSource.id,
          "knowledge.ingest.sourceEstablished",
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    } finally {
      createSubmitLockRef.current = false;
      setCreatingSource(false);
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

  async function retryImageExtraction(
    sourceId?: string,
    options?: { confirmReplaceCompleted?: boolean },
  ) {
    const targetId = sourceId ?? selected?.id;
    if (!targetId) return;
    setRetryingExtraction(true);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/knowledge/sources/${targetId}/retry-extraction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmReplaceCompleted: options?.confirmReplaceCompleted === true,
          }),
        },
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
      syncReviewDraftFromSource(payload.source);
      setSources((current) =>
        current.map((source) =>
          source.id === payload.source!.id
            ? { ...source, ...payload.source! }
            : source,
        ),
      );
      if (selected?.id === payload.source.id) {
        await applyOrganization(payload.source);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    } finally {
      setRetryingExtraction(false);
      setBusy(false);
    }
  }

  async function confirmVisionExtraction() {
    if (!selected) return;
    setConfirmingVisionReview(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/knowledge/sources/${selected.id}/confirm-extraction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rawText: reviewDraftText }),
        },
      );
      const payload = (await response.json()) as {
        source?: KnowledgeSourceDetail;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.source) {
        throw new Error(
          resolveKnowledgeApiError(t, payload, "knowledge.ingest.failure"),
        );
      }
      setSelected(payload.source);
      syncReviewDraftFromSource(payload.source);
      setSources((current) =>
        current.map((item) =>
          item.id === payload.source!.id
            ? { ...item, status: payload.source!.status, updatedAt: payload.source!.updatedAt }
            : item,
        ),
      );
      setSuccessToast(t("knowledge.ingest.visionReviewConfirmed"));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("knowledge.ingest.failure"),
      );
    } finally {
      setConfirmingVisionReview(false);
    }
  }

  async function organize() {
    if (!selected) return;
    const previousStatus = selected.status;
    setBusy(true);
    setError(null);
    const preserveKnowledgeCategory = manualCategoryOverrideRef.current;
    manualRequestedProjectOverrideRef.current = false;
    if (!preserveKnowledgeCategory) {
      manualCategoryOverrideRef.current = false;
    }
    clearOrganizerDraftFields({ preserveKnowledgeCategory });
    setSelected((current) =>
      current ? { ...current, status: "organizing" } : current,
    );
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
        if (
          payload.errorCode ===
          KNOWLEDGE_ERROR_CODES.SMART_INGEST_SEGMENT_SCOPE_REQUIRED
        ) {
          setSelected((current) =>
            current ? { ...current, status: previousStatus } : current,
          );
          await loadSource(selected.id);
          setError(getKnowledgeErrorMessage(t, payload.errorCode));
          analyzeSectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
          return;
        }
        throw new Error(resolveKnowledgeApiError(t, payload, "knowledge.ingest.failure"));
      }
      setSelected(payload.source);
      setSmartIngestScopeLive(payload.source.smartIngestScope);
      manualRequestedProjectOverrideRef.current = false;
      if (payload.source.smartIngestScope.blocksSourceLevelOrganize) {
        clearOrganizerDraftFields();
      } else {
        await applyOrganization(payload.source);
      }
      setSources((current) =>
        current.map((source) =>
          source.id === payload.source!.id ? payload.source! : source,
        ),
      );
      if (payload.source.organization?.status === "completed") {
        setAutoCompareSignal((current) => current + 1);
      }
    } catch (caught) {
      setSelected((current) =>
        current && current.status === "organizing"
          ? { ...current, status: previousStatus }
          : current,
      );
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    } finally {
      setBusy(false);
    }
  }

  async function handleAnalysisComplete() {
    if (!selected?.id) return;
    await loadSource(selected.id);
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    if (!categoryId) {
      setError(t("knowledge.ingest.knowledgeCategoryRequiredBeforeDraft"));
      return;
    }
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
  const smartIngestScope =
    smartIngestScopeLive ?? selected?.smartIngestScope ?? null;
  const blocksSourceLevelPipeline =
    smartIngestScope?.blocksSourceLevelOrganize === true;
  const organizationReady =
    selected?.organization?.status === "completed" && !blocksSourceLevelPipeline;
  const isArchivedView = lifecycle === "archived";
  const selectedArchived = Boolean(selected?.archivedAt);
  const inDetailMode = Boolean(selected);
  const organizerWarnings = selected?.organization?.warnings ?? [];
  const visionHumanReviewRequired = selected
    ? sourceRequiresVisionHumanReview({
        extractionMethod: selected.extractionMethod,
        extractionMetadata: selected.extractionMetadata,
        rawText: selected.rawText,
      })
    : false;
  const visionReviewConfirmed = selected
    ? visionExtractionReviewConfirmed(selected.extractionMetadata)
    : false;
  const visionOrganizeBlocked = selected
    ? sourceBlocksOrganizeForVisionReview({
        extractionMethod: selected.extractionMethod,
        extractionMetadata: selected.extractionMetadata,
        rawText: selected.rawText,
      })
    : false;
  const visionExtractionUsable = selected
    ? isVisionExtractionUsable({
        extractionMethod: selected.extractionMethod,
        extractionMetadata: selected.extractionMetadata,
        rawText: selected.rawText,
      })
    : true;
  const canConfirmVisionReview =
    Boolean(reviewDraftText.trim()) &&
    hasSubstantiveSourceEvidence(reviewDraftText);
  const canOrganizeSelected =
    Boolean(selected?.rawText) &&
    !selectedArchived &&
    !visionOrganizeBlocked &&
    !blocksSourceLevelPipeline &&
    selected?.status !== "converted" &&
    selected?.status !== "organizing";

  if (!canIngest) {
    return (
      <Card>
        <p className="crm-text-secondary">{t("common.insufficientPermission")}</p>
      </Card>
    );
  }

  const createSourceForm = (
    <>
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
                    accept=".txt,.md,.pdf,.docx,.jpg,.jpeg,.png"
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
                      <p className="mt-2 text-xs leading-5 crm-text-secondary">
                        {t("knowledge.ingest.imagePrivacyReminder")}
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
                          : file && isKnowledgeImageFilename(file.name)
                            ? t("knowledge.ingest.readingImageContent")
                            : t("knowledge.ingest.readingFileContent")}
                      </span>
                    </div>
                  )}
                  {duplicateNotice && (
                    <div
                      className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
                      data-duplicate-notice="true"
                      data-duplicate-case={duplicateNotice.case ?? "unknown"}
                      data-duplicate-kind={duplicateNotice.lifecycle}
                    >
                      <h3 className="text-sm font-semibold text-amber-950">
                        {duplicateNoticeTitle(duplicateNotice)}
                      </h3>
                      <p className="mt-2 text-sm text-amber-900">
                        {duplicateNoticeMessage(duplicateNotice)}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        {duplicateNotice.canContinueReview && (
                          <Button
                            type="button"
                            variant="primary"
                            data-duplicate-continue-review="true"
                            onClick={() =>
                              void openDuplicateSource(
                                duplicateNotice.id,
                                duplicateNotice.lifecycle,
                              )
                            }
                          >
                            {t("knowledge.ingest.continueHumanReview")}
                          </Button>
                        )}
                        {duplicateNotice.canReprocess && (
                          <Button
                            type="button"
                            disabled={busy || retryingExtraction}
                            data-reprocess-existing-source="true"
                            onClick={() => handleReprocessDuplicate(duplicateNotice)}
                          >
                            {retryingExtraction
                              ? t("knowledge.ingest.retryingImageExtraction")
                              : t("knowledge.ingest.reprocessExistingSource")}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          data-view-existing-source="true"
                          onClick={() =>
                            void openDuplicateSource(
                              duplicateNotice.id,
                              duplicateNotice.lifecycle,
                            )
                          }
                        >
                          {duplicateNotice.lifecycle === "archived"
                            ? t("knowledge.ingest.goToArchivedSources")
                            : duplicateNotice.case === "failed_extraction"
                              ? t("knowledge.ingest.viewFailedSource")
                              : t("knowledge.ingest.viewExistingSource")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <Button
                type="submit"
                disabled={
                  creatingSource ||
                  busy ||
                  (tab === "file" && !file)
                }
                className="w-full sm:w-auto"
                data-create-source-submit="true"
                aria-busy={creatingSource}
              >
                {creatingSource
                  ? t("knowledge.ingest.creatingSourceBusy")
                  : t("knowledge.ingest.createSource")}
              </Button>
            </form>
    </>
  );

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-clip">
      <Card className="border-amber-200 bg-amber-50">
        <p className="text-sm leading-6 text-amber-950">{t("knowledge.ingest.notice")}</p>
      </Card>
      {restoreNotice && (
        <Card className="border-emerald-200 bg-emerald-50">
          <p className="text-sm leading-6 text-emerald-950">{restoreNotice}</p>
        </Card>
      )}

      <div
        className={cn(
          "grid min-w-0 max-w-full gap-6",
          inDetailMode ? "grid-cols-1" : "lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]",
        )}
        data-ingest-layout={inDetailMode ? "detail" : "list"}
      >
        {!inDetailMode && (
        <aside className="min-w-0 space-y-4">
          <Card className="min-w-0 max-w-full p-4">
            <h2 className="font-semibold crm-text">{t("knowledge.ingest.sourceList")}</h2>
            <div className="mt-3 flex min-w-0 max-w-full gap-2 overflow-x-auto">
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
                  const isLoading = loadingSourceId === source.id;
                  const isActiveSelection = selected?.id === source.id;
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
                      aria-busy={isLoading}
                      className={cn(
                        "w-full min-w-0 rounded-xl border p-3 text-left transition-colors active:scale-[0.99] active:bg-slate-100",
                        isHighlighted
                          ? "border-blue-300 bg-blue-50 ring-2 ring-blue-200"
                          : isActiveSelection
                            ? "border-blue-200 bg-blue-50/70"
                            : "border-slate-200 hover:bg-slate-50",
                        isLoading && "opacity-80",
                      )}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <span className="block min-w-0 truncate text-sm font-medium crm-text">
                          {listTitle}
                        </span>
                        <Badge
                          variant={statusTone === "warning" ? "warning" : "accent"}
                          className="shrink-0"
                        >
                          {isLoading
                            ? t("common.loading")
                            : sourceListStatusLabel(t, source)}
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
        )}

        <main className="min-w-0 max-w-full space-y-4">
          {inDetailMode && selected && (
            <div ref={detailHeaderRef} className="space-y-4" data-source-detail="true">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-10 px-0 text-blue-700"
                data-back-to-source-list="true"
                onClick={clearSelectedSource}
              >
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                {t("knowledge.ingest.backToSourceList")}
              </Button>

              <Card className="p-4" data-ingest-step="raw-source">
                <KnowledgeIngestStepHeader
                  step={1}
                  title={t("knowledge.ingest.stepRawSource")}
                  status={selected.rawText ? t("knowledge.ingest.statusRead") : undefined}
                  tone={selected.rawText ? "success" : "warning"}
                />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold crm-text">
                      {selected.originalFilename ?? selected.sourceTitle ?? selected.sourceType}
                    </p>
                    <p className="mt-1 text-sm crm-text-secondary">
                      {new Date(selected.createdAt).toLocaleString()}
                    </p>
                  </div>
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
                </div>
                {selected.extractionMetadata &&
                visionExtractionAdvisoryKey(selected.extractionMetadata) ===
                  "complete" ? (
                  <p
                    className="mt-4 text-sm text-emerald-800"
                    data-vision-advisory="complete"
                  >
                    {t("knowledge.ingest.imageVisionComplete")}
                  </p>
                ) : null}
                {selected.extractionMetadata &&
                visionExtractionAdvisoryKey(selected.extractionMetadata) ===
                  "unusable" ? (
                  <div
                    className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4"
                    data-vision-advisory="unusable"
                  >
                    <p className="text-sm font-medium text-rose-950">
                      {t("knowledge.ingest.imageVisionUnusableTitle")}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-rose-900">
                      {t("knowledge.ingest.imageVisionUnusableBody")}
                    </p>
                  </div>
                ) : null}
                {selected.extractionMetadata &&
                visionExtractionAdvisoryKey(selected.extractionMetadata) ===
                  "review" ? (
                  <div
                    className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
                    data-vision-advisory="review"
                    data-vision-human-review-required={visionHumanReviewRequired ? "true" : "false"}
                  >
                    <p className="text-sm font-medium text-amber-950">
                      {visionHumanReviewRequired
                        ? t("knowledge.ingest.imageVisionHumanReviewTitle")
                        : t("knowledge.ingest.imageVisionReview", {
                            count: String(selected.extractionMetadata.warnings.length),
                          })}
                    </p>
                    {visionHumanReviewRequired ? (
                      <p className="mt-2 text-sm leading-6 text-amber-900">
                        {t("knowledge.ingest.imageVisionHumanReviewBody")}
                      </p>
                    ) : null}
                    {selected.extractionMetadata.warnings.length > 0 ? (
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
                        {selected.extractionMetadata.warnings.map((warning, index) => (
                          <li key={`${warning.code}-${index}`}>
                            {warning.message ?? warning.code}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {selected.rawText || (visionHumanReviewRequired && !visionExtractionUsable) ? (
                  visionHumanReviewRequired && !visionReviewConfirmed ? (
                    <div className="mt-4 space-y-3" data-vision-review-editor="true">
                      <label className="block text-sm font-medium crm-text">
                        {visionExtractionUsable
                          ? t("knowledge.ingest.visionReviewExtractedText")
                          : t("knowledge.ingest.imageVisionManualSupplement")}
                        <textarea
                          value={reviewDraftText}
                          onChange={(event) => setReviewDraftText(event.target.value)}
                          className="mt-2 min-h-48 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6"
                          maxLength={100_000}
                          data-vision-review-textarea="true"
                          placeholder={
                            visionExtractionUsable
                              ? undefined
                              : t("knowledge.ingest.imageVisionPreviewMockNotice")
                          }
                        />
                      </label>
                      {canRetryVisionExtraction(selected) && (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy || retryingExtraction}
                          data-retry-image-extraction="true"
                          onClick={() => void retryImageExtraction()}
                        >
                          {retryingExtraction
                            ? t("knowledge.ingest.retryingImageExtraction")
                            : t("knowledge.ingest.retryImageExtraction")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={confirmingVisionReview || !canConfirmVisionReview}
                        data-confirm-vision-review="true"
                        onClick={() => void confirmVisionExtraction()}
                      >
                        {confirmingVisionReview
                          ? t("knowledge.ingest.confirmingVisionReview")
                          : t("knowledge.ingest.confirmVisionReview")}
                      </Button>
                    </div>
                  ) : (
                    <pre
                      className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-6 crm-text"
                      data-vision-extracted-text="true"
                    >
                      {selected.rawText}
                    </pre>
                  )
                ) : selected.status === "extracting" || retryingExtraction ? (
                  <div
                    className="mt-4 flex items-center gap-2 text-sm text-slate-700"
                    data-extraction-retrying="true"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {t("knowledge.ingest.retryingImageExtraction")}
                  </div>
                ) : (
                  <div
                    className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
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
                    {canRetryVisionExtraction(selected) && (
                      <div className="mt-4">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy || retryingExtraction}
                          data-retry-image-extraction="true"
                          onClick={() => void retryImageExtraction()}
                        >
                          {retryingExtraction
                            ? t("knowledge.ingest.retryingImageExtraction")
                            : t("knowledge.ingest.retryImageExtraction")}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {!selectedArchived && selected.sourceType === "paste" && (
                <div ref={analyzeSectionRef}>
                  <KnowledgeSmartIngestAnalysisSection
                    key={selected.id}
                    source={selected}
                    onAnalysisStatusChange={syncSourceAnalysisStatus}
                    onScopeChange={setSmartIngestScopeLive}
                    onAnalysisComplete={handleAnalysisComplete}
                  />
                </div>
              )}

              {!selectedArchived && selected.status !== "converted" && (
                <Card className="p-4" data-ingest-step="organize">
                  <KnowledgeIngestStepHeader
                    step={3}
                    title={t("knowledge.ingest.stepOrganize")}
                    status={
                      organizationReady
                        ? t("knowledge.ingest.statusCompleted")
                        : selected.status === "organizing" || busy
                          ? t("knowledge.ingest.organizing")
                          : undefined
                    }
                    tone={
                      organizationReady
                        ? "success"
                        : selected.status === "organizing" || busy
                          ? "processing"
                          : "neutral"
                    }
                  />
                  {blocksSourceLevelPipeline ? (
                    <div
                      className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950"
                      data-smart-ingest-multi-topic-block="true"
                    >
                      <p className="font-medium">
                        {t("knowledge.ingest.smartIngestMultiTopicTitle", {
                          count: String(
                            smartIngestScope?.retainedProposedSegmentCount ?? 0,
                          ),
                        })}
                      </p>
                      <p className="mt-2">
                        {t("knowledge.ingest.smartIngestMultiTopicBody")}
                      </p>
                    </div>
                  ) : null}
                  {visionOrganizeBlocked ? (
                    <p
                      className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
                      data-organize-blocked-human-review="true"
                    >
                      {t("knowledge.ingest.organizeBlockedHumanReview")}
                    </p>
                  ) : null}
                  {visionHumanReviewRequired && visionReviewConfirmed ? (
                    <p
                      className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"
                      data-vision-review-confirmed="true"
                    >
                      {t("knowledge.ingest.visionReviewConfirmedNotice")}
                    </p>
                  ) : null}
                  {canOrganizeSelected && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button
                        type="button"
                        onClick={() => void organize()}
                        disabled={busy || selected.status === "organizing"}
                        data-organize-button="true"
                      >
                        {busy
                          ? t("knowledge.ingest.organizing")
                          : organizationReady
                            ? t("knowledge.ingest.reorganize")
                            : t("knowledge.ingest.organize")}
                      </Button>
                    </div>
                  )}
                  {organizationReady && (
                    <div className="mt-4 space-y-3">
                      <p className="text-sm crm-text-secondary">
                        {t("knowledge.ingest.warning")}
                      </p>
                      {organizerWarnings.length > 0 && (
                        <div
                          className="rounded-xl border border-amber-200 bg-amber-50 p-4"
                          data-organizer-advisory="true"
                        >
                          <div className="flex items-start gap-2">
                            <AlertCircle
                              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-amber-950">
                                {t("knowledge.ingest.organizerAdvisoryTitle", {
                                  count: String(organizerWarnings.length),
                                })}
                              </p>
                              <p className="mt-1 text-sm text-amber-900">
                                {t("knowledge.ingest.organizerAdvisoryBody")}
                              </p>
                              <ul className="mt-3 space-y-1 text-sm text-amber-900">
                                {organizerWarnings.map((warning) => (
                                  <li key={warning}>{warning}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}

              {organizationReady && !selectedArchived && (
                <Card className="p-4" data-ingest-step="comparison">
                  <KnowledgeIngestStepHeader
                    step={3}
                    title={t("knowledge.ingest.stepComparison")}
                  />
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
                    className="mt-4 border-0 p-0 shadow-none"
                  />
                </Card>
              )}

              {organizationReady && !selectedArchived && (
                <Card className="p-4" data-ingest-step="draft">
                  <KnowledgeIngestStepHeader
                    step={4}
                    title={t("knowledge.ingest.stepDraft")}
                  />
                  <p className="mt-3 text-sm crm-text-secondary">
                    {t("knowledge.ingest.draftPendingComparisonHint")}
                  </p>
                  <form
                    ref={organizerFormRef}
                    className="mt-4 space-y-4"
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
                    <div className="space-y-2">
                      <p className="text-sm font-medium crm-text">
                        {t("knowledge.ingest.businessCategory")}
                      </p>
                      <RequestedProjectSelector
                        locale={locale}
                        valueCode={requestedProjectCode}
                        valueName={requestedProjectName}
                        placeholder={t("knowledge.ingest.businessCategoryPlaceholder")}
                        selectServiceTitle={t("customers.requestedProjectSelectService")}
                        selectCountryTitle={t("customers.requestedProjectSelectCountry")}
                        searchPlaceholder={t("customers.requestedProjectSearchPlaceholder")}
                        backLabel={t("common.back")}
                        closeLabel={t("common.close")}
                        onSelect={({ code }) => {
                          manualRequestedProjectOverrideRef.current = true;
                          const item = getRequestedProjectItem(code);
                          setRequestedProjectCode(code);
                          setRequestedProjectName(item?.canonicalZhHans ?? "");
                          setCategoryNotice("none");
                          if (selected?.organization?.status === "completed") {
                            void fetchOrganizerDraft(selected, {
                              manualRequestedProjectCode: code,
                              manualRequestedProjectOverride: true,
                            })
                              .then((draft) => {
                                if (draft) applyOrganizerDraft(draft);
                              })
                              .catch((caught) => {
                                setError(
                                  caught instanceof Error
                                    ? caught.message
                                    : t("knowledge.ingest.failure"),
                                );
                              });
                          }
                        }}
                      />
                      {categoryNotice === "needs_confirmation" ? (
                        <p className="text-sm text-amber-800" data-category-notice="needs_confirmation">
                          {t("knowledge.ingest.businessCategoryNeedsConfirmation")}
                        </p>
                      ) : null}
                      {categoryNotice === "no_match" ? (
                        <p className="text-sm text-amber-800" data-category-notice="no_match">
                          {t("knowledge.ingest.businessCategoryNoMatch")}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium crm-text">
                          {t("knowledge.ingest.knowledgeLibraryCategory")}
                        </p>
                        {categoryResolutionSource === "explicit_mapping" ? (
                          <Badge variant="accent" className="text-xs">
                            {t("knowledge.ingest.categoryAutoMatched")}
                          </Badge>
                        ) : null}
                      </div>
                      <select
                        required
                        value={categoryId}
                        onChange={(event) => {
                          manualCategoryOverrideRef.current = true;
                          setCategoryId(event.target.value);
                          setCategoryResolutionSource("manual");
                        }}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
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
                    </div>
                    <Button
                      type="submit"
                      disabled={busy || selected.status === "converted"}
                    >
                      {busy
                        ? t("knowledge.ingest.savingDraft")
                        : saved
                          ? t("knowledge.ingest.savedDraft")
                          : t("knowledge.ingest.saveDraft")}
                    </Button>
                  </form>
                </Card>
              )}

              {!selectedArchived && selected.status !== "converted" && (
                <Card className="p-4" data-ingest-step="source-management">
                  <KnowledgeIngestStepHeader
                    title={t("knowledge.ingest.stepSourceManagement")}
                  />
                  <div className="mt-4">
                    <KnowledgeSourceArchiveButton
                      sourceId={selected.id}
                      updatedAt={selected.updatedAt}
                      onArchived={() => {
                        clearSelectedSource();
                        switchLifecycle("active");
                        router.refresh();
                      }}
                    />
                  </div>
                </Card>
              )}

              {selectedArchived && (
                <Card className="p-4">
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
                </Card>
              )}
            </div>
          )}

          {!inDetailMode && !isArchivedView && (
          <>
          <div
            className="flex w-full min-w-0 justify-end"
            data-new-source-action-row="true"
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="inline-flex max-w-full shrink-0"
              data-new-source-action="true"
              onClick={() =>
                createFormOpen ? setCreateFormOpen(false) : openCreateSourcePanel()
              }
            >
              {t("knowledge.ingest.newSourceAction")}
            </Button>
          </div>
          {createFormOpen && !isMobileViewport && (
          <div ref={createFormPanelRef}>
          <Card data-create-source-panel="true">
            {createSourceForm}
          </Card>
          </div>
          )}
          </>
          )}

          <KnowledgeMobileSheet
            open={createFormOpen && isMobileViewport}
            title={t("knowledge.ingest.newSourceAction")}
            closeLabel={t("common.close")}
            onClose={() => setCreateFormOpen(false)}
          >
            <div data-create-source-panel="true" data-create-source-mobile-sheet="true">
              {createSourceForm}
            </div>
          </KnowledgeMobileSheet>

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
