"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  Paperclip,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { MailFormattingToolbar } from "@/components/mail/prototype/mail-formatting-toolbar";
import { MailComposeFromSelector } from "@/components/mail/compose/mail-compose-from-selector";
import { MailComposeSignatureBlock } from "@/components/mail/compose/mail-compose-signature-block";
import { MailRecipientChipsField } from "@/components/mail/compose/mail-recipient-chips-field";
import { MailComposeSubmissionStatus } from "@/components/mail/compose/mail-compose-submission-status";
import {
  MailComposeDraftGate,
  useMailComposeDraft,
} from "@/components/mail/compose/use-mail-compose-draft";
import { MailComposeAttachmentList } from "@/components/mail/compose/mail-compose-attachment-list";
import {
  buildRecipientLists,
  composeMobileRootClass,
  type ComposeInitialSeed,
} from "@/lib/mail/client/draft-management";

export function MailComposeEditor({
  variant,
  seed,
  onBack,
  onClose,
  onToggleExpand,
  expanded = false,
  onSubmitted,
}: {
  variant: "embedded-mobile" | "floating-desktop";
  seed?: ComposeInitialSeed;
  onBack?: () => void;
  onClose?: () => void;
  onToggleExpand?: () => void;
  expanded?: boolean;
  onSubmitted?: () => void;
}) {
  const dismiss = onClose ?? onBack ?? (() => {});
  const {
    loading,
    loadError,
    composeOptions,
    state,
    approval,
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
    retryBootstrap,
  } = useMailComposeDraft({
    seed,
    onClose: dismiss,
    onSubmitted: onSubmitted,
  });

  return (
    <MailComposeDraftGate
      loading={loading}
      loadError={loadError}
      onRetry={() => void retryBootstrap()}
    >
      <MailComposeEditorBody
        variant={variant}
        composeOptions={composeOptions}
        state={state}
        updateField={updateField}
        selectFrom={selectFrom}
        flushSave={flushSave}
        onDiscard={() => void handleDiscard()}
        onSubmit={() => void handleSubmitForApproval()}
        onPickFiles={handlePickFiles}
        onRemoveAttachment={(attachmentId) =>
          void handleRemoveAttachment(attachmentId)
        }
        onRetryAttachment={(attachmentId) =>
          handleRetryAttachmentUpload(attachmentId)
        }
        onCancelAttachment={(attachmentId) =>
          handleCancelAttachmentUpload(attachmentId)
        }
        canSubmit={canSubmit}
        submissionPhase={submissionPhase}
        approval={approval}
        outboundDisplayPhase={outboundDisplayPhase}
        submissionError={submissionError}
        submissionIssues={submissionIssues}
        buildSubmissionIssueMessageKey={buildSubmissionIssueMessageKey}
        onClose={() => {
          void flushSave().then(dismiss);
        }}
        onBack={onBack}
        onToggleExpand={onToggleExpand}
        expanded={expanded}
      />
    </MailComposeDraftGate>
  );
}

function MailComposeEditorBody({
  variant,
  composeOptions,
  state,
  updateField,
  selectFrom,
  flushSave,
  onDiscard,
  onSubmit,
  onPickFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onCancelAttachment,
  canSubmit,
  submissionPhase,
  approval,
  outboundDisplayPhase,
  submissionError,
  submissionIssues,
  buildSubmissionIssueMessageKey,
  onClose,
  onBack,
  onToggleExpand,
  expanded,
}: {
  variant: "embedded-mobile" | "floating-desktop";
  composeOptions: Parameters<typeof MailComposeFromSelector>[0]["options"];
  state: ReturnType<typeof useMailComposeDraft>["state"];
  updateField: ReturnType<typeof useMailComposeDraft>["updateField"];
  selectFrom: ReturnType<typeof useMailComposeDraft>["selectFrom"];
  flushSave: ReturnType<typeof useMailComposeDraft>["flushSave"];
  onDiscard: () => void;
  onSubmit: () => void;
  onPickFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRetryAttachment: (attachmentId: string) => void;
  onCancelAttachment: (attachmentId: string) => void;
  canSubmit: boolean;
  submissionPhase: ReturnType<typeof useMailComposeDraft>["submissionPhase"];
  approval: ReturnType<typeof useMailComposeDraft>["approval"];
  outboundDisplayPhase: ReturnType<
    typeof useMailComposeDraft
  >["outboundDisplayPhase"];
  submissionError: string | null;
  submissionIssues: ReturnType<typeof useMailComposeDraft>["submissionIssues"];
  buildSubmissionIssueMessageKey: ReturnType<
    typeof useMailComposeDraft
  >["buildSubmissionIssueMessageKey"];
  onClose: () => void;
  onBack?: () => void;
  onToggleExpand?: () => void;
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(false);
  const [showCcBcc, setShowCcBcc] = useState(variant === "floating-desktop");
  const [showFormatting, setShowFormatting] = useState(false);
  const [submitTouched, setSubmitTouched] = useState(false);
  const isMobile = variant === "embedded-mobile";
  const isFloating = variant === "floating-desktop";
  const allLists = buildRecipientLists(state);

  useEffect(() => {
    if (hydratedRef.current || !editorRef.current) return;
    editorRef.current.innerHTML = state.bodyHtml;
    setShowCcBcc(
      isFloating || state.cc.length > 0 || state.bcc.length > 0,
    );
    hydratedRef.current = true;
  }, [isFloating, state.bodyHtml, state.bcc.length, state.cc.length]);

  const savedTimeLabel =
    state.lastSavedAt &&
    new Date(state.lastSavedAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  const saveLabel =
    state.saveStatus === "saving"
      ? t("mail.compose.saving")
      : state.saveStatus === "saved" && savedTimeLabel
        ? t("mail.compose.savedAt", { time: savedTimeLabel })
        : state.saveStatus === "error"
          ? state.saveError
          : null;

  function handleBodyInput() {
    const html = editorRef.current?.innerHTML ?? "";
    updateField("bodyHtml", html);
  }

  function handlePickFilesEvent(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files?.length) return;
    onPickFiles(Array.from(files));
    event.target.value = "";
  }

  function confirmDiscard() {
    if (!window.confirm(t("mail.compose.discardConfirm"))) return;
    onDiscard();
  }

  return (
    <div className={composeMobileRootClass(variant)}>
      {isMobile ? (
        <div className="flex shrink-0 items-center gap-2 border-b crm-border px-3 py-1.5">
          <button
            type="button"
            onClick={onBack ?? onClose}
            className="flex min-h-9 items-center gap-1 text-sm crm-text"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            {t("mail.compose.backToMail")}
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium crm-text">
            {t("mail.compose.new")}
          </span>
          {saveLabel ? (
            <span className="truncate text-xs crm-text-secondary">{saveLabel}</span>
          ) : null}
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1 border-b crm-border px-2 py-1.5 sm:px-3">
          <button
            type="button"
            onClick={onClose}
            className="mail-compose-toolbar-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
          {onToggleExpand ? (
            <button
              type="button"
              onClick={onToggleExpand}
              className="mail-compose-toolbar-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
              aria-label={
                expanded ? t("mail.compose.restore") : t("mail.compose.expand")
              }
            >
              {expanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          ) : null}
          <div className="min-w-0 flex-1 truncate px-1 text-sm font-medium crm-text">
            {t("mail.compose.new")}
          </div>
          {saveLabel ? (
            <span className="truncate text-xs crm-text-secondary">{saveLabel}</span>
          ) : null}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mail-compose-toolbar-btn flex h-9 w-9 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            aria-label={t("mail.compose.attachments")}
          >
            <Paperclip className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MailComposeFromSelector
          options={composeOptions}
          senderIdentityId={state.senderIdentityId}
          mailboxId={state.mailboxId}
          onChange={selectFrom}
        />

        <div className="space-y-2 px-3 py-2">
          <MailRecipientChipsField
            label={t("mail.compose.to")}
            field="to"
            chips={state.to}
            onChange={(chips) => updateField("to", chips)}
            allLists={allLists}
            placeholder={t("mail.recipient.placeholder")}
            showCcBccToggle={!showCcBcc}
            onToggleCcBcc={() => setShowCcBcc(true)}
            compact={isMobile}
          />
          {showCcBcc ? (
            <>
              <MailRecipientChipsField
                label={t("mail.compose.cc")}
                field="cc"
                chips={state.cc}
                onChange={(chips) => updateField("cc", chips)}
                allLists={allLists}
                placeholder={t("mail.recipient.placeholder")}
                compact={isMobile}
              />
              <MailRecipientChipsField
                label={t("mail.compose.bcc")}
                field="bcc"
                chips={state.bcc}
                onChange={(chips) => updateField("bcc", chips)}
                allLists={allLists}
                placeholder={t("mail.recipient.placeholder")}
                compact={isMobile}
              />
            </>
          ) : null}

          <div className="flex min-w-0 items-center gap-2">
            <label
              htmlFor="mail-compose-subject"
              className="w-12 shrink-0 text-sm crm-text-secondary"
            >
              {t("mail.compose.subject")}
            </label>
            <input
              id="mail-compose-subject"
              type="text"
              value={state.subject}
              onChange={(event) => updateField("subject", event.target.value)}
              className={cn(
                "min-h-10 min-w-0 flex-1 rounded-lg border crm-border px-3 text-sm outline-none",
                isFloating
                  ? "mail-compose-input"
                  : "bg-transparent crm-text",
              )}
            />
          </div>
        </div>

        {showFormatting ? (
          <MailFormattingToolbar editorRef={editorRef} />
        ) : null}

        <div className="px-3 pb-2">
          <div className="flex items-center justify-between gap-2 pb-2">
            <button
              type="button"
              onClick={() => setShowFormatting((value) => !value)}
              className="text-xs crm-text-secondary hover:crm-text"
            >
              {t("mail.compose.formatting")}
            </button>
            {isMobile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 text-xs crm-text-secondary hover:crm-text"
              >
                <Paperclip className="h-3.5 w-3.5" />
                {t("mail.compose.attachments")}
              </button>
            ) : null}
          </div>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleBodyInput}
            className={cn(
              "min-h-[12rem] rounded-lg border crm-border px-3 py-2 text-sm outline-none",
              isFloating ? "mail-compose-input" : "crm-text bg-transparent",
              "empty:before:text-neutral-400 empty:before:content-[attr(data-placeholder)]",
              "dark:empty:before:text-neutral-500",
            )}
            data-placeholder={t("mail.compose.body")}
          />
        </div>

        {state.attachments.length > 0 ? (
          <MailComposeAttachmentList
            attachments={state.attachments}
            variant={variant}
            onRemove={onRemoveAttachment}
            onRetry={onRetryAttachment}
            onCancel={onCancelAttachment}
          />
        ) : null}

        <MailComposeSignatureBlock senderIdentityId={state.senderIdentityId} />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t crm-border px-3 py-2">
        <MailComposeSubmissionStatus
          phase={submissionPhase}
          approval={approval}
          outboundDisplayPhase={outboundDisplayPhase}
          submissionError={submissionError}
        />
        {submitTouched && submissionIssues.length > 0 ? (
          <ul className="space-y-1 text-sm text-red-600 dark:text-red-400">
            {submissionIssues.map((issue) => (
              <li key={issue}>{t(buildSubmissionIssueMessageKey(issue))}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={confirmDiscard}>
            {t("mail.compose.discardDraft")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || submissionPhase === "submitting"}
            onClick={() => {
              setSubmitTouched(true);
              onSubmit();
            }}
          >
            {submissionPhase === "submitting"
              ? t("mail.compose.submitting")
              : approval?.status === "returned"
                ? t("mail.compose.resubmitApproval")
                : t("mail.compose.submitApproval")}
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handlePickFilesEvent}
      />
    </div>
  );
}
