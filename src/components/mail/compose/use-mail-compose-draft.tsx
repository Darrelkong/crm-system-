"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
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
  postApprovalResubmit,
  submitRevisionForApproval,
  updateDraft,
} from "@/lib/mail/client/api";
import type { ApprovalApiItem } from "@/lib/mail/client/approval-workflow-management";
import {
  resolveApprovedOutboundDisplayPhase,
  type SendDeliveryLifecycleApiItem,
  type SendOperationApiItem,
} from "@/lib/mail/client/approved-outbound-queue";
import {
  buildSubmissionIssueMessageKey,
  canSubmitComposeForApproval,
  findAuthorApprovalForDraft,
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
  createQueuedAttachmentEntry,
  deleteDraftAttachment,
  mergeUploadedDraftAttachments,
  uploadDraftAttachmentWithProgress,
  validateLocalAttachmentFile,
  type ComposeAttachmentUploadState,
} from "@/lib/mail/client/compose-attachment-upload";
import { initChipsFromDraft } from "@/lib/mail/client/recipient-input";
import {
  MailAdminErrorState,
  MailAdminLoadingState,
} from "@/components/mail/admin/mail-admin-states";

const SAVE_DEBOUNCE_MS = 700;

type AttachmentUploadSidecar = {
  localId: string;
  file: File;
  abortController: AbortController;
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
      attachment.uploadStatus === "uploading",
    uploadStatus: attachment.uploadStatus,
    uploadProgress: attachment.uploadProgress,
    error: attachment.error,
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
  seed?: ComposeInitialSeed;
  onClose?: () => void;
  onSubmitted?: (approval: ApprovalApiItem) => void;
}) {
  const [composeOptions, setComposeOptions] = useState<ComposeContextOption[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
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
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionIssues, setSubmissionIssues] = useState<
    ComposeSubmissionIssueCode[]
  >([]);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const uploadQueueRunningRef = useRef(false);
  const uploadSidecarsRef = useRef<Map<string, AttachmentUploadSidecar>>(
    new Map(),
  );
  const stateRef = useRef(state);
  stateRef.current = composeStateWithAttachments(state, uploadAttachments);
  const uploadAttachmentsRef = useRef(uploadAttachments);
  uploadAttachmentsRef.current = uploadAttachments;

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const contextResult = await fetchComposeContext();
    if (!contextResult.ok) {
      setLoading(false);
      setLoadError(contextResult.error);
      return;
    }

    const options = contextResult.items;
    setComposeOptions(options);

    if (input.seed?.draftId) {
      const draftResult = await fetchDraft(input.seed.draftId);
      if (!draftResult.ok) {
        setLoading(false);
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
        setLoading(false);
        setLoadError("Selected From address is not authorized for compose");
        return;
      }
      const linkedApproval = await loadDraftApproval(draftResult.item.id);
      setApproval(linkedApproval);
      const send = await loadSendOperationForApproval(linkedApproval);
      setSendOperation(send);
      setSendDelivery(await loadSendDeliveryLifecycle(send));
      setUploadAttachments(restoredUploads);
      setState(restored);
      hydratedRef.current = true;
      setLoading(false);
      return;
    }

    const defaultOption = resolveDefaultComposeOption(options, {
      senderIdentityId: input.seed?.senderIdentityId,
      mailboxId: input.seed?.mailboxId,
    });

    setState((current) => ({
      ...current,
      senderIdentityId: defaultOption?.senderIdentityId ?? null,
      mailboxId: defaultOption?.mailboxId ?? null,
      to: initChipsFromDraft(input.seed?.to),
      cc: initChipsFromDraft(input.seed?.cc),
      bcc: initChipsFromDraft(input.seed?.bcc),
      subject: input.seed?.subject ?? "",
      bodyHtml: input.seed?.bodyHtml ?? "",
    }));
    setApproval(null);
    setSendOperation(null);
    setSendDelivery(null);
    setUploadAttachments([]);
    hydratedRef.current = true;
    setLoading(false);
  }, [input.seed]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const persistDraft = useCallback(
    async (snapshot: ComposeEditorState): Promise<ComposeEditorState | null> => {
      if (savingRef.current) {
        return stateRef.current;
      }
      if (!snapshot.senderIdentityId || !snapshot.mailboxId) {
        return null;
      }

      const lists = buildRecipientLists(snapshot);
      if (
        !hasMeaningfulComposeContent({
          subject: snapshot.subject,
          bodyHtml: snapshot.bodyHtml,
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
          const created = await createDraft(payload);
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
          setUploadAttachments((current) =>
            current.map((attachment) =>
              attachment.localId === queued.localId
                ? {
                    ...attachment,
                    uploadStatus: "failed",
                    error: "Upload file missing",
                  }
                : attachment,
            ),
          );
          continue;
        }

        let working = stateRef.current;
        if (!working.draftId) {
          const saved = await persistDraft(working);
          if (!saved?.draftId) {
            setUploadAttachments((current) =>
              current.map((attachment) =>
                attachment.localId === queued.localId
                  ? {
                      ...attachment,
                      uploadStatus: "failed",
                      error: "Draft must be saved before uploading attachments",
                    }
                  : attachment,
              ),
            );
            continue;
          }
          working = composeStateWithAttachments(saved, uploadAttachmentsRef.current);
        }

        setUploadAttachments((current) =>
          current.map((attachment) =>
            attachment.localId === queued.localId
              ? {
                  ...attachment,
                  uploadStatus: "uploading",
                  uploadProgress: 0,
                  error: null,
                }
              : attachment,
          ),
        );

        const result = await uploadDraftAttachmentWithProgress({
          draftId: working.draftId!,
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
                    }
                  : attachment,
              ),
            );
            uploadSidecarsRef.current.set(queued.localId, {
              ...sidecar,
              abortController: new AbortController(),
            });
            continue;
          }
        }

        setUploadAttachments((current) =>
          current.map((attachment) =>
            attachment.localId === queued.localId
              ? {
                  ...attachment,
                  uploadStatus: "failed",
                  uploadProgress: 0,
                  error: result.error,
                }
              : attachment,
          ),
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
  }, [persistDraft]);

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
          })),
        ]);
        if (!validation.ok) {
          setSubmissionError(validation.error);
          continue;
        }
        const entry = createQueuedAttachmentEntry(file, (bytes) =>
          formatAttachmentSize(bytes),
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
      setUploadAttachments((current) => [...current, ...additions]);
      void processUploadQueue();
    },
    [processUploadQueue],
  );

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
      uploadSidecarsRef.current.set(match.localId, {
        localId: match.localId,
        file: match.file,
        abortController: new AbortController(),
      });
      setUploadAttachments((current) =>
        current.map((attachment) =>
          attachment.localId === match.localId
            ? {
                ...attachment,
                uploadStatus: "queued",
                uploadProgress: 0,
                error: null,
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
      void persistDraft(stateRef.current);
    }, SAVE_DEBOUNCE_MS);
  }, [persistDraft]);

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
      setState((current) => ({ ...current, [key]: value }));
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
    }
    return persistDraft(stateRef.current);
  }, [persistDraft]);

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
      return;
    }

    setSubmitting(true);
    setSubmissionError(null);
    setSubmissionIssues([]);

    try {
      const saved = await flushSave();
      const working = saved ?? stateRef.current;
      if (!working.draftId) {
        setSubmissionError("Draft must be saved before submission");
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
  }, [approval, composeOptions, flushSave, input]);

  const submissionPhase = resolveComposeSubmissionPhase({
    submitting,
    approval,
  });
  const outboundDisplayPhase = resolveApprovedOutboundDisplayPhase({
    approval,
    send: sendOperation,
    delivery: sendDelivery,
  });
  const canSubmit = canSubmitComposeForApproval(
    stateRef.current,
    composeOptions,
    approval,
  );

  return {
    loading,
    loadError,
    composeOptions,
    state: composeStateWithAttachments(state, uploadAttachments),
    approval,
    sendOperation,
    outboundDisplayPhase,
    submissionPhase,
    submissionError,
    submissionIssues,
    canSubmit,
    buildSubmissionIssueMessageKey,
    updateField,
    selectFrom,
    flushSave,
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
  loading,
  loadError,
  onRetry,
  children,
}: {
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <MailAdminLoadingState />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <MailAdminErrorState message={loadError} onRetry={onRetry} />
      </div>
    );
  }
  return <>{children}</>;
}
