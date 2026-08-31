"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n/provider";
import {
  createAdminDirectDraftRevision,
  createDraft,
  createDraftRevision,
  discardDraft,
  fetchApproval,
  fetchApprovals,
  fetchComposeContext,
  fetchDraft,
  fetchOutboundRevision,
  fetchSendOperationDelivery,
  fetchSendOperationForApproval,
  initiateAdminDirectSend,
  postApprovalResubmit,
  submitRevisionForApproval,
  updateDraft,
} from "@/lib/mail/client/api";
import type { ApprovalApiItem } from "@/lib/mail/client/approval-workflow-management";
import {
  resolveOutboundDisplayPhase,
  type SendDeliveryLifecycleApiItem,
  type SendOperationApiItem,
} from "@/lib/mail/client/approved-outbound-queue";
import {
  buildAdminDirectSendIdempotencyKey,
  buildSubmissionIssueMessageKey,
  canSubmitComposeForApproval,
  findAuthorApprovalForDraft,
  resolveComposeOutboundWorkflow,
  resolveComposeSubmissionPhase,
  validateComposeForSubmission,
  type ComposeSubmissionIssueCode,
} from "@/lib/mail/client/compose-submission";
import {
  buildDraftAutosavePayload,
  buildRecipientLists,
  composeMobileRootClass,
  createEmptyComposeState,
  draftDetailToComposeState,
  formatAttachmentSize,
  hasMeaningfulComposeContent,
  isAuthorizedComposeSelection,
  resolveDefaultComposeOption,
  type ComposeAttachmentDraft,
  type ComposeContextOption,
  type ComposeEditorState,
  type ComposeInitialSeed,
} from "@/lib/mail/client/draft-management";
import {
  buildAttachmentPolicyMessageKey,
  composeAttachmentPolicyErrorParams,
  composeAttachmentUploadErrorMessageKey,
  createQueuedAttachmentEntry,
  deleteDraftAttachment,
  mergeUploadedDraftAttachments,
  uploadDraftAttachmentWithProgress,
  validateLocalAttachmentFile,
  type ComposeAttachmentUploadErrorCode,
  type ComposeAttachmentUploadState,
} from "@/lib/mail/client/compose-attachment-upload";
import { uploadLargeDraftAttachmentWithProgress } from "@/lib/mail/client/compose-large-attachment-upload";
import {
  ComposeDraftPersistenceError,
  resolvePersistedDraftId,
} from "@/lib/mail/client/compose-draft-persistence";
import {
  getCachedComposeContext,
  prefetchComposeContext,
  setCachedComposeContext,
} from "@/lib/mail/client/compose-context-cache";
import { initChipsFromDraft } from "@/lib/mail/client/recipient-input";

const SAVE_DEBOUNCE_MS = 700;

type AttachmentUploadSidecar = {
  localId: string;
  file: File;
  abortController: AbortController;
  largeUploadSessionId?: string;
  largePutCompleted?: boolean;
};

function uploadStatesToComposeAttachments(
  attachments: ComposeAttachmentUploadState[],
): ComposeAttachmentDraft[] {
  return attachments.map((attachment) => ({
    id: attachment.serverId ?? attachment.localId,
    name: attachment.name,
    sizeLabel: attachment.sizeLabel,
    sizeBytes: attachment.sizeBytes,
    kind: attachment.kind,
    pendingUpload:
      attachment.uploadStatus === "queued" ||
      attachment.uploadStatus === "preparing" ||
      attachment.uploadStatus === "hashing" ||
      attachment.uploadStatus === "uploading" ||
      attachment.uploadStatus === "finalizing",
    uploadStatus: attachment.uploadStatus,
    uploadProgress: attachment.uploadProgress,
    error: attachment.error,
    errorCode: attachment.errorCode,
    largeAttachmentExpired: attachment.largeAttachmentExpired ?? false,
  }));
}

function composeStateWithAttachments(
  base: ComposeEditorState,
  uploadAttachments: ComposeAttachmentUploadState[],
): ComposeEditorState {
  return {
    ...base,
    attachments: uploadStatesToComposeAttachments(uploadAttachments),
  };
}

async function loadDraftApproval(
  draftId: string,
): Promise<ApprovalApiItem | null> {
  const approvalsResult = await fetchApprovals({ scope: "author" });
  if (!approvalsResult.ok || approvalsResult.items.length === 0) {
    return null;
  }

  const revisionsById = new Map<
    string,
    { sourceDraftId: string | null }
  >();
  const revisionIds = [
    ...new Set(approvalsResult.items.map((item) => item.currentRevisionId)),
  ];
  await Promise.all(
    revisionIds.map(async (revisionId) => {
      const revisionResult = await fetchOutboundRevision(revisionId);
      if (revisionResult.ok) {
        revisionsById.set(revisionId, {
          sourceDraftId: revisionResult.item.sourceDraftId,
        });
      }
    }),
  );

  const match = findAuthorApprovalForDraft(
    draftId,
    approvalsResult.items,
    revisionsById,
  );
  if (!match) {
    return null;
  }

  const detail = await fetchApproval(match.id);
  return detail.ok ? detail.item : match;
}

async function loadSendOperationForApproval(
  approval: ApprovalApiItem | null,
): Promise<SendOperationApiItem | null> {
  if (!approval || approval.status !== "approved") {
    return null;
  }
  const result = await fetchSendOperationForApproval(approval.id);
  if (!result.ok) {
    return null;
  }
  return result.item;
}

async function loadSendDeliveryLifecycle(
  send: SendOperationApiItem | null,
): Promise<SendDeliveryLifecycleApiItem | null> {
  if (!send || send.status !== "accepted") {
    return null;
  }
  const result = await fetchSendOperationDelivery(send.id);
  if (!result.ok) {
    return null;
  }
  return result.item;
}

export function useMailComposeDraft(input: {
  actorUserId: string | null;
  isCrmRootAdmin?: boolean;
  seed?: ComposeInitialSeed;
  bodyHtmlReaderRef?: React.MutableRefObject<(() => string) | null>;
  onClose?: () => void;
  onDraftPersisted?: () => void;
  onSubmitted?: (approval: ApprovalApiItem) => void;
}) {
  const actorUserId = input.actorUserId;
  const isCrmRootAdmin = input.isCrmRootAdmin ?? false;
  const composeOutboundWorkflow = resolveComposeOutboundWorkflow(isCrmRootAdmin);
  const [composeOptions, setComposeOptions] = useState<ComposeContextOption[]>(
    () => getCachedComposeContext(actorUserId) ?? [],
  );
  const [contextLoading, setContextLoading] = useState(
    () =>
      actorUserId != null && getCachedComposeContext(actorUserId) === null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<ComposeEditorState>(() =>
    createEmptyComposeState(input.seed),
  );
  const [uploadAttachments, setUploadAttachments] = useState<
    ComposeAttachmentUploadState[]
  >([]);
  const [approval, setApproval] = useState<ApprovalApiItem | null>(null);
  const [sendOperation, setSendOperation] = useState<SendOperationApiItem | null>(
    null,
  );
  const [sendDelivery, setSendDelivery] = useState<SendDeliveryLifecycleApiItem | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [draftHydrating, setDraftHydrating] = useState(Boolean(input.seed?.draftId));
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionErrorParams, setSubmissionErrorParams] = useState<
    Record<string, string> | undefined
  >(undefined);
  const [submissionIssues, setSubmissionIssues] = useState<
    ComposeSubmissionIssueCode[]
  >([]);
  const hydratedRef = useRef(false);
  const bootstrapGenerationRef = useRef(0);
  const bodyEditGenerationRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const persistInFlightRef = useRef<Promise<ComposeEditorState | null> | null>(
    null,
  );
  const uploadQueueRunningRef = useRef(false);
  const uploadSidecarsRef = useRef<Map<string, AttachmentUploadSidecar>>(
    new Map(),
  );
  const stateRef = useRef(state);
  stateRef.current = composeStateWithAttachments(state, uploadAttachments);
  const uploadAttachmentsRef = useRef(uploadAttachments);
  uploadAttachmentsRef.current = uploadAttachments;

  const bootstrap = useCallback(async () => {
    const generation = ++bootstrapGenerationRef.current;
    const bootstrapActorUserId = actorUserId;
    hydratedRef.current = false;
    setLoadError(null);

    if (!bootstrapActorUserId) {
      setComposeOptions([]);
      setContextLoading(false);
      return;
    }

    let options = getCachedComposeContext(bootstrapActorUserId);
    if (!options) {
      setContextLoading(true);
      options = await prefetchComposeContext(bootstrapActorUserId);
      if (generation !== bootstrapGenerationRef.current) return;
      if (actorUserId !== bootstrapActorUserId) return;
      if (!options) {
        const contextResult = await fetchComposeContext();
        if (generation !== bootstrapGenerationRef.current) return;
        if (actorUserId !== bootstrapActorUserId) return;
        if (!contextResult.ok) {
          setContextLoading(false);
          setLoadError(contextResult.error);
          return;
        }
        options = contextResult.items;
        setCachedComposeContext(bootstrapActorUserId, options);
      }
      setContextLoading(false);
    }

    if (generation !== bootstrapGenerationRef.current) return;
    if (actorUserId !== bootstrapActorUserId) return;

    setComposeOptions(options);

    if (input.seed?.draftId) {
      setDraftHydrating(true);
      const bodyEditGenerationAtStart = bodyEditGenerationRef.current;
      const draftResult = await fetchDraft(input.seed.draftId);
      if (generation !== bootstrapGenerationRef.current) return;
      if (!draftResult.ok) {
        setDraftHydrating(false);
        setLoadError(draftResult.error);
        return;
      }
      const restored = draftDetailToComposeState(draftResult.item);
      const restoredUploads = draftResult.item.attachments.map((attachment) => ({
        localId: attachment.id,
        serverId: attachment.id,
        name: attachment.displayFilename,
        sizeBytes: attachment.sizeBytes ?? 0,
        sizeLabel: formatAttachmentSize(attachment.sizeBytes),
        kind: attachment.deliveryMode,
        uploadStatus: "uploaded" as const,
        uploadProgress: 100,
        error: null,
        errorCode: null,
        file: null,
      }));
      if (
        restored.senderIdentityId &&
        restored.mailboxId &&
        !isAuthorizedComposeSelection(
          options,
          restored.senderIdentityId,
          restored.mailboxId,
        )
      ) {
        setLoadError("Selected From address is not authorized for compose");
        setDraftHydrating(false);
        return;
      }
      const hasLiveBodyEdits =
        bodyEditGenerationRef.current !== bodyEditGenerationAtStart;
      setUploadAttachments(restoredUploads);
      setState((current) => {
        if (!hasLiveBodyEdits) {
          return restored;
        }
        return {
          ...restored,
          bodyHtml: current.bodyHtml,
          subject: current.subject,
          to: current.to,
          cc: current.cc,
          bcc: current.bcc,
        };
      });
      stateRef.current = composeStateWithAttachments(
        hasLiveBodyEdits
          ? {
              ...restored,
              bodyHtml: stateRef.current.bodyHtml,
              subject: stateRef.current.subject,
              to: stateRef.current.to,
              cc: stateRef.current.cc,
              bcc: stateRef.current.bcc,
            }
          : restored,
        restoredUploads,
      );
      hydratedRef.current = true;
      setDraftHydrating(false);

      void (async () => {
        const linkedApproval = await loadDraftApproval(draftResult.item.id);
        if (generation !== bootstrapGenerationRef.current) return;
        setApproval(linkedApproval);
        const send = await loadSendOperationForApproval(linkedApproval);
        if (generation !== bootstrapGenerationRef.current) return;
        setSendOperation(send);
        setSendDelivery(await loadSendDeliveryLifecycle(send));
      })();
      return;
    }

    const defaultOption = resolveDefaultComposeOption(options, {
      senderIdentityId: input.seed?.senderIdentityId,
      mailboxId: input.seed?.mailboxId,
    });

    const seededState = {
      ...createEmptyComposeState(input.seed),
      senderIdentityId: defaultOption?.senderIdentityId ?? null,
      mailboxId: defaultOption?.mailboxId ?? null,
      to: initChipsFromDraft(input.seed?.to),
      cc: initChipsFromDraft(input.seed?.cc),
      bcc: initChipsFromDraft(input.seed?.bcc),
      subject: input.seed?.subject ?? "",
      bodyHtml: input.seed?.bodyHtml ?? "",
    };
    if (generation !== bootstrapGenerationRef.current) return;
    setState(seededState);
    stateRef.current = composeStateWithAttachments(seededState, []);
    setApproval(null);
    setSendOperation(null);
    setSendDelivery(null);
    setUploadAttachments([]);
    hydratedRef.current = true;
    setDraftHydrating(false);
  }, [
    actorUserId,
    input.seed?.bcc,
    input.seed?.bodyHtml,
    input.seed?.cc,
    input.seed?.draftId,
    input.seed?.mailboxId,
    input.seed?.senderIdentityId,
    input.seed?.subject,
    input.seed?.to,
  ]);

  useEffect(() => {
    if (!actorUserId) {
      setComposeOptions([]);
      setContextLoading(false);
      return;
    }
    const cached = getCachedComposeContext(actorUserId);
    setComposeOptions(cached ?? []);
    setContextLoading(cached === null);
  }, [actorUserId]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const waitForSaveIdle = useCallback(async () => {
    while (savingRef.current) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 25);
      });
    }
  }, []);

  const syncStateRef = useCallback(() => {
    stateRef.current = composeStateWithAttachments(
      stateRef.current,
      uploadAttachmentsRef.current,
    );
  }, []);

  const syncBodyFromEditor = useCallback(() => {
    const bodyHtml =
      input.bodyHtmlReaderRef?.current?.() ?? stateRef.current.bodyHtml;
    if (bodyHtml === stateRef.current.bodyHtml) {
      return stateRef.current;
    }
    bodyEditGenerationRef.current += 1;
    const next = composeStateWithAttachments(
      { ...stateRef.current, bodyHtml },
      uploadAttachmentsRef.current,
    );
    stateRef.current = next;
    setState((current) => ({ ...current, bodyHtml }));
    return next;
  }, [input.bodyHtmlReaderRef]);

  const persistDraftInternal = useCallback(
    async (
      snapshot: ComposeEditorState,
      options?: { allowEmptyShell?: boolean },
    ): Promise<ComposeEditorState | null> => {
      if (savingRef.current) {
        await waitForSaveIdle();
        snapshot = stateRef.current;
      }
      if (!snapshot.senderIdentityId || !snapshot.mailboxId) {
        return null;
      }

      const lists = buildRecipientLists(snapshot);
      const allowEmptyShell = options?.allowEmptyShell === true;
      if (
        !allowEmptyShell &&
        !hasMeaningfulComposeContent({
          subject: snapshot.subject,
          bodyHtml: snapshot.bodyHtml,
          quotedBodyHtml: snapshot.quotedBodyHtml,
          recipientLists: lists,
          attachmentCount: snapshot.attachments.length,
        })
      ) {
        return null;
      }

      savingRef.current = true;
      setState((current) => ({
        ...current,
        saveStatus: "saving",
        saveError: null,
      }));

      try {
        const payload = buildDraftAutosavePayload(snapshot);

        if (!snapshot.draftId) {
          const created = await createDraft({
            ...payload,
            allowEmptyShell: allowEmptyShell || undefined,
          });
          if (!created.ok) {
            setState((current) => ({
              ...current,
              saveStatus: "error",
              saveError: created.error,
            }));
            return null;
          }
          if (!created.created || !created.item) {
            setState((current) => ({
              ...current,
              saveStatus: "idle",
              saveError: null,
            }));
            return null;
          }
          const nextState: ComposeEditorState = {
            ...snapshot,
            draftId: created.item.id,
            autosaveVersion: created.item.autosaveVersion,
            saveStatus: "saved",
            saveError: null,
            lastSavedAt: created.item.lastSavedAt,
          };
          stateRef.current = nextState;
          setState(nextState);
          return nextState;
        }

        const updated = await updateDraft(snapshot.draftId, {
          expectedAutosaveVersion: snapshot.autosaveVersion,
          ...payload,
        });

        if (!updated.ok) {
          if (updated.errorCode === "STALE_VERSION") {
            const refreshed = await fetchDraft(snapshot.draftId);
            if (refreshed.ok) {
              const merged = draftDetailToComposeState(refreshed.item);
              const retryState = {
                ...snapshot,
                autosaveVersion: merged.autosaveVersion,
              };
              stateRef.current = retryState;
              setState((current) => ({
                ...current,
                autosaveVersion: merged.autosaveVersion,
                saveStatus: "idle",
              }));
              return persistDraft(retryState);
            }
          }
          setState((current) => ({
            ...current,
            saveStatus: "error",
            saveError: updated.error,
          }));
          return null;
        }

        const nextState: ComposeEditorState = {
          ...snapshot,
          autosaveVersion: updated.item.autosaveVersion,
          saveStatus: "saved",
          saveError: null,
          lastSavedAt: updated.item.lastSavedAt,
        };
        stateRef.current = nextState;
        setState(nextState);
        return nextState;
      } finally {
        savingRef.current = false;
      }
    },
    [waitForSaveIdle],
  );

  const persistDraft = useCallback(
    async (
      snapshot: ComposeEditorState,
      options?: { allowEmptyShell?: boolean },
    ): Promise<ComposeEditorState | null> => {
      if (persistInFlightRef.current) {
        return persistInFlightRef.current;
      }

      const promise = persistDraftInternal(snapshot, options);
      persistInFlightRef.current = promise;
      try {
        return await promise;
      } finally {
        if (persistInFlightRef.current === promise) {
          persistInFlightRef.current = null;
        }
      }
    },
    [persistDraftInternal],
  );

  const ensurePersistedDraft = useCallback(async (): Promise<string> => {
    syncBodyFromEditor();
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const existingDraftId = resolvePersistedDraftId(stateRef.current);
    if (existingDraftId) {
      await waitForSaveIdle();
      const currentDraftId = resolvePersistedDraftId(stateRef.current);
      if (currentDraftId) {
        return currentDraftId;
      }
    }

    const snapshot = stateRef.current;
    if (!snapshot.senderIdentityId || !snapshot.mailboxId) {
      throw new ComposeDraftPersistenceError(
        "MISSING_FROM",
        "From address is required before saving a draft",
      );
    }

    const saved = await persistDraft(snapshot, { allowEmptyShell: true });
    const draftId = saved ? resolvePersistedDraftId(saved) : null;
    if (draftId) {
      return draftId;
    }

    if (snapshot.saveError) {
      throw new ComposeDraftPersistenceError(
        "DRAFT_SAVE_FAILED",
        snapshot.saveError,
      );
    }

    throw new ComposeDraftPersistenceError(
      "DRAFT_NOT_PERSISTED",
      "Draft was not persisted",
    );
  }, [persistDraft, syncBodyFromEditor, waitForSaveIdle]);

  const markAttachmentFailed = useCallback(
    (
      localId: string,
      errorCode: ComposeAttachmentUploadErrorCode,
      error: string | null = null,
    ) => {
      setUploadAttachments((current) =>
        current.map((attachment) =>
          attachment.localId === localId
            ? {
                ...attachment,
                uploadStatus: "failed",
                uploadProgress: 0,
                error,
                errorCode,
              }
            : attachment,
        ),
      );
    },
    [],
  );

  const processUploadQueue = useCallback(async () => {
    if (uploadQueueRunningRef.current) {
      return;
    }
    uploadQueueRunningRef.current = true;

    try {
      while (true) {
        const queued = uploadAttachmentsRef.current.find(
          (attachment) => attachment.uploadStatus === "queued",
        );
        if (!queued) {
          break;
        }

        const sidecar = uploadSidecarsRef.current.get(queued.localId);
        if (!sidecar) {
          markAttachmentFailed(queued.localId, "UPLOAD_FILE_MISSING");
          continue;
        }

        const finalizeOnlySessionId =
          sidecar.largePutCompleted && sidecar.largeUploadSessionId
            ? sidecar.largeUploadSessionId
            : undefined;

        setUploadAttachments((current) =>
          current.map((attachment) =>
            attachment.localId === queued.localId
              ? {
                  ...attachment,
                  uploadStatus: "uploading",
                  uploadProgress: 0,
                  error: null,
                  errorCode: null,
                }
              : attachment,
          ),
        );

        let draftId: string;
        try {
          draftId = await ensurePersistedDraft();
        } catch (error) {
          const errorCode: ComposeAttachmentUploadErrorCode =
            error instanceof ComposeDraftPersistenceError
              ? error.code === "MISSING_FROM"
                ? "MISSING_FROM"
                : error.code === "DRAFT_NOT_PERSISTED"
                  ? "DRAFT_NOT_PERSISTED"
                  : "DRAFT_SAVE_FAILED"
              : "DRAFT_SAVE_FAILED";
          markAttachmentFailed(queued.localId, errorCode);
          continue;
        }

        const working = composeStateWithAttachments(
          stateRef.current,
          uploadAttachmentsRef.current,
        );

        if (queued.uploadRoute === "large") {
          const largeResult = await uploadLargeDraftAttachmentWithProgress({
            draftId,
            file: sidecar.file,
            expectedAutosaveVersion: working.autosaveVersion,
            signal: sidecar.abortController.signal,
            finalizeOnly: finalizeOnlySessionId
              ? { uploadSessionId: finalizeOnlySessionId }
              : undefined,
            onPhase: (phase) => {
              setUploadAttachments((current) =>
                current.map((attachment) =>
                  attachment.localId === queued.localId
                    ? {
                        ...attachment,
                        uploadStatus:
                          phase === "hashing"
                            ? "hashing"
                            : phase === "uploading"
                              ? "uploading"
                              : phase === "finalizing"
                                ? "finalizing"
                                : "preparing",
                      }
                    : attachment,
                ),
              );
            },
            onProgress: (percent) => {
              setUploadAttachments((current) =>
                current.map((attachment) =>
                  attachment.localId === queued.localId
                    ? { ...attachment, uploadProgress: percent }
                    : attachment,
                ),
              );
            },
          });

          if (largeResult.ok) {
            uploadSidecarsRef.current.delete(queued.localId);
            setUploadAttachments((current) =>
              mergeUploadedDraftAttachments(
                current.filter((attachment) => attachment.localId !== queued.localId),
                largeResult.item,
                formatAttachmentSize,
              ),
            );
            setState((current) => ({
              ...current,
              autosaveVersion: largeResult.item.autosaveVersion,
              lastSavedAt: largeResult.item.lastSavedAt,
            }));
            continue;
          }

          if (largeResult.cancelled) {
            uploadSidecarsRef.current.delete(queued.localId);
            setUploadAttachments((current) =>
              current.filter((attachment) => attachment.localId !== queued.localId),
            );
            continue;
          }

          if (largeResult.putCompleted && largeResult.uploadSessionId) {
            uploadSidecarsRef.current.set(queued.localId, {
              ...sidecar,
              largeUploadSessionId: largeResult.uploadSessionId,
              largePutCompleted: true,
            });
          } else {
            uploadSidecarsRef.current.delete(queued.localId);
          }

          if (largeResult.errorCode === "STALE_VERSION" && working.draftId) {
            const refreshed = await fetchDraft(working.draftId);
            if (refreshed.ok) {
              setState((current) => ({
                ...current,
                autosaveVersion: refreshed.item.autosaveVersion,
              }));
              setUploadAttachments((current) =>
                current.map((attachment) =>
                  attachment.localId === queued.localId
                    ? {
                        ...attachment,
                        uploadStatus: "queued",
                        uploadProgress: 0,
                        error: null,
                        errorCode: null,
                      }
                    : attachment,
                ),
              );
              const preservedSidecar = uploadSidecarsRef.current.get(queued.localId);
              uploadSidecarsRef.current.set(queued.localId, {
                localId: queued.localId,
                file: sidecar.file,
                abortController: new AbortController(),
                largeUploadSessionId: preservedSidecar?.largeUploadSessionId,
                largePutCompleted: preservedSidecar?.largePutCompleted,
              });
              continue;
            }
          }

          markAttachmentFailed(
            queued.localId,
            largeResult.putCompleted ? "LARGE_FINALIZE_FAILED" : "LARGE_UPLOAD_FAILED",
            largeResult.error,
          );
          continue;
        }

        const result = await uploadDraftAttachmentWithProgress({
          draftId,
          file: sidecar.file,
          expectedAutosaveVersion: working.autosaveVersion,
          signal: sidecar.abortController.signal,
          onProgress: (percent) => {
            setUploadAttachments((current) =>
              current.map((attachment) =>
                attachment.localId === queued.localId
                  ? { ...attachment, uploadProgress: percent }
                  : attachment,
              ),
            );
          },
        });

        uploadSidecarsRef.current.delete(queued.localId);

        if (result.ok) {
          setUploadAttachments((current) =>
            mergeUploadedDraftAttachments(
              current.filter((attachment) => attachment.localId !== queued.localId),
              result.item,
              formatAttachmentSize,
            ),
          );
          setState((current) => ({
            ...current,
            autosaveVersion: result.item.autosaveVersion,
            lastSavedAt: result.item.lastSavedAt,
          }));
          continue;
        }

        if (result.cancelled) {
          setUploadAttachments((current) =>
            current.filter((attachment) => attachment.localId !== queued.localId),
          );
          continue;
        }

        if (result.errorCode === "STALE_VERSION" && working.draftId) {
          const refreshed = await fetchDraft(working.draftId);
          if (refreshed.ok) {
            setState((current) => ({
              ...current,
              autosaveVersion: refreshed.item.autosaveVersion,
            }));
            setUploadAttachments((current) =>
              current.map((attachment) =>
                attachment.localId === queued.localId
                  ? {
                      ...attachment,
                      uploadStatus: "queued",
                      uploadProgress: 0,
                      error: null,
                      errorCode: null,
                    }
                  : attachment,
              ),
            );
            uploadSidecarsRef.current.set(queued.localId, {
              localId: queued.localId,
              file: sidecar.file,
              abortController: new AbortController(),
            });
            continue;
          }
        }

        markAttachmentFailed(
          queued.localId,
          "DRAFT_SAVE_FAILED",
          result.error,
        );
      }
    } finally {
      uploadQueueRunningRef.current = false;
      if (
        uploadAttachmentsRef.current.some(
          (attachment) => attachment.uploadStatus === "queued",
        )
      ) {
        void processUploadQueue();
      }
    }
  }, [ensurePersistedDraft, markAttachmentFailed]);

  const handlePickFiles = useCallback(
    (files: FileList | File[]) => {
      const selected = Array.from(files);
      if (selected.length === 0) return;

      const additions: ComposeAttachmentUploadState[] = [];
      const validationBaseline = [...uploadAttachmentsRef.current];
      for (const file of selected) {
        const validation = validateLocalAttachmentFile(file, [
          ...validationBaseline,
          ...additions.map((entry) => ({
            sizeBytes: entry.sizeBytes,
            uploadStatus: entry.uploadStatus,
            kind: entry.kind,
            uploadRoute: entry.uploadRoute,
          })),
        ]);
        if (!validation.ok) {
          setSubmissionError(
            composeAttachmentUploadErrorMessageKey(validation.errorCode),
          );
          setSubmissionErrorParams(
            composeAttachmentPolicyErrorParams(
              validation.errorCode as import("@/lib/mail/compose-attachment-policy").ComposeAttachmentPolicyIssueCode,
            ),
          );
          continue;
        }
        const entry = createQueuedAttachmentEntry(
          file,
          (bytes) => formatAttachmentSize(bytes),
          validation.uploadRoute,
        );
        additions.push(entry);
        uploadSidecarsRef.current.set(entry.localId, {
          localId: entry.localId,
          file,
          abortController: new AbortController(),
        });
      }

      if (additions.length === 0) {
        return;
      }

      setSubmissionIssues([]);
      setSubmissionError(null);
      setSubmissionErrorParams(undefined);
      setUploadAttachments((current) => {
        const next = [...current, ...additions];
        uploadAttachmentsRef.current = next;
        return next;
      });
      queueMicrotask(() => {
        void processUploadQueue();
      });
    },
    [processUploadQueue],
  );

  useEffect(() => {
    if (
      uploadAttachments.some((attachment) => attachment.uploadStatus === "queued")
    ) {
      void processUploadQueue();
    }
  }, [uploadAttachments, processUploadQueue]);

  const handleCancelAttachmentUpload = useCallback((attachmentId: string) => {
    const match = uploadAttachmentsRef.current.find(
      (attachment) =>
        attachment.localId === attachmentId || attachment.serverId === attachmentId,
    );
    if (!match) return;
    const sidecar = uploadSidecarsRef.current.get(match.localId);
    sidecar?.abortController.abort();
    uploadSidecarsRef.current.delete(match.localId);
    setUploadAttachments((current) =>
      current.filter((attachment) => attachment.localId !== match.localId),
    );
  }, []);

  const handleRetryAttachmentUpload = useCallback(
    (attachmentId: string) => {
      const match = uploadAttachmentsRef.current.find(
        (attachment) =>
          attachment.localId === attachmentId ||
          attachment.serverId === attachmentId,
      );
      if (!match?.file) return;
      const existingSidecar = uploadSidecarsRef.current.get(match.localId);
      uploadSidecarsRef.current.set(match.localId, {
        localId: match.localId,
        file: match.file,
        abortController: new AbortController(),
        largeUploadSessionId: existingSidecar?.largeUploadSessionId,
        largePutCompleted: existingSidecar?.largePutCompleted,
      });
      setUploadAttachments((current) =>
        current.map((attachment) =>
          attachment.localId === match.localId
            ? {
                ...attachment,
                uploadStatus: "queued",
                uploadProgress: 0,
                error: null,
                errorCode: null,
              }
            : attachment,
        ),
      );
      void processUploadQueue();
    },
    [processUploadQueue],
  );

  const handleRemoveAttachment = useCallback(
    async (attachmentId: string) => {
      const match = uploadAttachmentsRef.current.find(
        (attachment) =>
          attachment.localId === attachmentId ||
          attachment.serverId === attachmentId,
      );
      if (!match) return;

      if (
        match.uploadStatus === "queued" ||
        match.uploadStatus === "uploading"
      ) {
        handleCancelAttachmentUpload(attachmentId);
        return;
      }

      if (match.uploadStatus === "failed") {
        uploadSidecarsRef.current.delete(match.localId);
        setUploadAttachments((current) =>
          current.filter((attachment) => attachment.localId !== match.localId),
        );
        return;
      }

      const draftId = stateRef.current.draftId;
      if (!draftId || !match.serverId) {
        setUploadAttachments((current) =>
          current.filter((attachment) => attachment.localId !== match.localId),
        );
        return;
      }

      const result = await deleteDraftAttachment({
        draftId,
        attachmentId: match.serverId,
        expectedAutosaveVersion: stateRef.current.autosaveVersion,
      });

      if (!result.ok) {
        setSubmissionError(result.error);
        return;
      }

      setUploadAttachments((current) =>
        mergeUploadedDraftAttachments(
          current.filter((attachment) => attachment.localId !== match.localId),
          result.item,
          formatAttachmentSize,
        ),
      );
      setState((current) => ({
        ...current,
        autosaveVersion: result.item.autosaveVersion,
        lastSavedAt: result.item.lastSavedAt,
      }));
    },
    [handleCancelAttachmentUpload],
  );

  const scheduleAutosave = useCallback(() => {
    if (!hydratedRef.current) return;
    setState((current) =>
      current.saveStatus === "saved"
        ? { ...current, saveStatus: "saving" }
        : current.saveStatus === "error"
          ? current
          : { ...current, saveStatus: "saving" },
    );
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      syncBodyFromEditor();
      void persistDraft(stateRef.current);
    }, SAVE_DEBOUNCE_MS);
  }, [persistDraft, syncBodyFromEditor]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const updateField = useCallback(
    <K extends keyof ComposeEditorState>(
      key: K,
      value: ComposeEditorState[K],
    ) => {
      setSubmissionIssues([]);
      setSubmissionError(null);
      setSubmissionErrorParams(undefined);
      setState((current) => {
        const next = { ...current, [key]: value };
        if (key === "bodyHtml") {
          bodyEditGenerationRef.current += 1;
        }
        stateRef.current = composeStateWithAttachments(
          next,
          uploadAttachmentsRef.current,
        );
        return next;
      });
      scheduleAutosave();
    },
    [scheduleAutosave],
  );

  const selectFrom = useCallback(
    (option: ComposeContextOption) => {
      if (
        !isAuthorizedComposeSelection(
          composeOptions,
          option.senderIdentityId,
          option.mailboxId,
        )
      ) {
        return;
      }
      setSubmissionIssues([]);
      setSubmissionError(null);
      setSubmissionErrorParams(undefined);
      setState((current) => ({
        ...current,
        senderIdentityId: option.senderIdentityId,
        mailboxId: option.mailboxId,
      }));
      scheduleAutosave();
    },
    [composeOptions, scheduleAutosave],
  );

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    syncBodyFromEditor();
    return persistDraft(stateRef.current);
  }, [persistDraft, syncBodyFromEditor]);

  const handleClose = useCallback(async () => {
    if (closing) return;
    setClosing(true);
    try {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await waitForSaveIdle();
      syncBodyFromEditor();
      const snapshot = stateRef.current;
      const lists = buildRecipientLists(snapshot);
      const meaningful = hasMeaningfulComposeContent({
        subject: snapshot.subject,
        bodyHtml: snapshot.bodyHtml,
        quotedBodyHtml: snapshot.quotedBodyHtml,
        recipientLists: lists,
        attachmentCount: snapshot.attachments.length,
      });

      if (meaningful) {
        const saved = await persistDraft(snapshot);
        if (!saved) {
          return;
        }
        input.onDraftPersisted?.();
      } else if (snapshot.draftId) {
        await discardDraft(snapshot.draftId);
      }

      input.onClose?.();
    } finally {
      setClosing(false);
    }
  }, [
    closing,
    input,
    persistDraft,
    syncBodyFromEditor,
    waitForSaveIdle,
  ]);

  const handleDiscard = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    const draftId = stateRef.current.draftId;
    if (draftId) {
      await discardDraft(draftId);
    }
    input.onClose?.();
  }, [input]);

  const handleSubmitForApproval = useCallback(async () => {
    const snapshot = stateRef.current;
    const validation = validateComposeForSubmission(
      snapshot,
      composeOptions,
      approval,
    );
    if (!validation.ok) {
      setSubmissionIssues(validation.issues);
      setSubmissionError(null);
      setSubmissionErrorParams(undefined);
      return;
    }

    setSubmitting(true);
    setSubmissionError(null);
    setSubmissionErrorParams(undefined);
    setSubmissionIssues([]);

    try {
      const saved = await flushSave();
      const working = saved ?? stateRef.current;
      if (!working.draftId) {
        setSubmissionError("Draft must be saved before submission");
        return;
      }

      if (composeOutboundWorkflow === "admin_direct") {
        const revisionResult = await createAdminDirectDraftRevision(
          working.draftId,
          { expectedAutosaveVersion: working.autosaveVersion },
        );
        if (!revisionResult.ok) {
          if (revisionResult.errorCode === "STALE_VERSION") {
            const refreshed = await fetchDraft(working.draftId);
            if (refreshed.ok) {
              const merged = draftDetailToComposeState(refreshed.item);
              stateRef.current = { ...working, ...merged };
              setState((current) => ({ ...current, ...merged }));
            }
          }
          setSubmissionError(revisionResult.error);
          return;
        }

        const sendResult = await initiateAdminDirectSend(
          revisionResult.item.id,
          {
            idempotencyKey: buildAdminDirectSendIdempotencyKey(
              revisionResult.item.id,
            ),
          },
        );
        if (!sendResult.ok) {
          setSubmissionError(sendResult.error);
          return;
        }

        setApproval(null);
        setSendOperation(sendResult.item);
        setSendDelivery(await loadSendDeliveryLifecycle(sendResult.item));
        return;
      }

      const revisionResult = await createDraftRevision(working.draftId, {
        expectedAutosaveVersion: working.autosaveVersion,
      });
      if (!revisionResult.ok) {
        if (revisionResult.errorCode === "STALE_VERSION") {
          const refreshed = await fetchDraft(working.draftId);
          if (refreshed.ok) {
            const merged = draftDetailToComposeState(refreshed.item);
            stateRef.current = { ...working, ...merged };
            setState((current) => ({ ...current, ...merged }));
          }
        }
        setSubmissionError(revisionResult.error);
        return;
      }

      let approvalItem: ApprovalApiItem;
      if (approval?.status === "returned") {
        const resubmitResult = await postApprovalResubmit(approval.id, {
          revisionId: revisionResult.item.id,
          expectedWorkflowVersion: approval.workflowVersion,
        });
        if (!resubmitResult.ok) {
          setSubmissionError(resubmitResult.error);
          return;
        }
        approvalItem = resubmitResult.item;
      } else {
        const submitResult = await submitRevisionForApproval(
          revisionResult.item.id,
        );
        if (!submitResult.ok) {
          setSubmissionError(submitResult.error);
          return;
        }
        approvalItem = submitResult.item;
      }

      setApproval(approvalItem);
      input.onSubmitted?.(approvalItem);
    } finally {
      setSubmitting(false);
    }
  }, [approval, composeOptions, composeOutboundWorkflow, flushSave, input]);

  const submissionPhase = resolveComposeSubmissionPhase({
    submitting,
    approval,
    send: sendOperation,
  });
  const outboundDisplayPhase = resolveOutboundDisplayPhase({
    approval,
    send: sendOperation,
    delivery: sendDelivery,
  });
  const canSubmit = canSubmitComposeForApproval(
    stateRef.current,
    composeOptions,
    approval,
    sendOperation,
  );

  return {
    contextLoading,
    loadError,
    composeOptions,
    state: composeStateWithAttachments(state, uploadAttachments),
    approval,
    sendOperation,
    outboundDisplayPhase,
    submissionPhase,
    composeOutboundWorkflow,
    submissionError,
    submissionErrorParams,
    submissionIssues,
    canSubmit,
    closing,
    draftHydrating,
    buildSubmissionIssueMessageKey,
    updateField,
    selectFrom,
    flushSave,
    syncBodyFromEditor,
    handleClose,
    handleDiscard,
    handleSubmitForApproval,
    handlePickFiles,
    handleRemoveAttachment,
    handleRetryAttachmentUpload,
    handleCancelAttachmentUpload,
    buildAttachmentPolicyMessageKey,
    retryBootstrap: bootstrap,
    composeMobileRootClass,
  };
}

export function MailComposeDraftGate({
  loadError,
  onRetry,
  children,
}: {
  loadError: string | null;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <>
      {loadError ? (
        <div
          className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/50 dark:bg-red-950/20"
          role="alert"
        >
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 text-xs font-medium text-red-700 underline dark:text-red-300"
          >
            {t("mail.adminCenter.retry")}
          </button>
        </div>
      ) : null}
      {children}
    </>
  );
}
