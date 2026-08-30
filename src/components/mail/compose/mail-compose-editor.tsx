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
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
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
  insertTextAtCaret,
  MailComposeEmojiPicker,
} from "@/components/mail/compose/mail-compose-emoji-picker";
import {
  buildRecipientLists,
  composeMobileRootClass,
  type ComposeInitialSeed,
} from "@/lib/mail/client/draft-management";
import { resolveComposeTitleKey } from "@/lib/mail/client/compose-reply-body";
import { resolveComposeSubmitButtonLabelKey } from "@/lib/mail/client/compose-submission";
import { normalizeInvisiblePastedForeground } from "@/lib/mail/client/compose-paste-normalization";

export function MailComposeEditor({
  variant,
  seed,
  onBack,
  onClose,
  onToggleExpand,
  expanded = false,
  onSubmitted,
  onDraftPersisted,
}: {
  variant: "embedded-mobile" | "floating-desktop";
  seed?: ComposeInitialSeed;
  onBack?: () => void;
  onClose?: () => void;
  onToggleExpand?: () => void;
  expanded?: boolean;
  onSubmitted?: () => void;
  onDraftPersisted?: () => void;
}) {
  const dismiss = onClose ?? onBack ?? (() => {});
  const { session } = useMailSession();
  const bodyHtmlReaderRef = useRef<(() => string) | null>(null);
  const {
    contextLoading,
    loadError,
    composeOptions,
    state,
    approval,
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
    handleClose,
    handleDiscard,
    handleSubmitForApproval,
    handlePickFiles,
    handleRemoveAttachment,
    handleRetryAttachmentUpload,
    handleCancelAttachmentUpload,
    syncBodyFromEditor,
    retryBootstrap,
  } = useMailComposeDraft({
    actorUserId: session?.user.id ?? null,
    isCrmRootAdmin: session?.isCrmRootAdmin ?? false,
    seed,
    bodyHtmlReaderRef,
    onClose: dismiss,
    onDraftPersisted,
    onSubmitted: onSubmitted,
  });

  return (
    <MailComposeDraftGate
      loadError={loadError}
      onRetry={() => void retryBootstrap()}
    >
      <MailComposeEditorBody
        variant={variant}
        expanded={expanded}
        contextLoading={contextLoading}
        composeOptions={composeOptions}
        state={state}
        updateField={updateField}
        selectFrom={selectFrom}
        onClose={() => void handleClose()}
        onDiscard={() => void handleDiscard()}
        onSubmit={() => void handleSubmitForApproval()}
        flushSave={flushSave}
        syncBodyFromEditor={syncBodyFromEditor}
        closing={closing}
        draftHydrating={draftHydrating}
        bodyHtmlReaderRef={bodyHtmlReaderRef}
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
        composeOutboundWorkflow={composeOutboundWorkflow}
        approval={approval}
        outboundDisplayPhase={outboundDisplayPhase}
        submissionError={submissionError}
        submissionErrorParams={submissionErrorParams}
        submissionIssues={submissionIssues}
        buildSubmissionIssueMessageKey={buildSubmissionIssueMessageKey}
        onBack={onBack}
        onToggleExpand={onToggleExpand}
      />
    </MailComposeDraftGate>
  );
}

function MailComposeEditorBody({
  variant,
  expanded = false,
  contextLoading,
  composeOptions,
  state,
  updateField,
  selectFrom,
  onClose,
  onDiscard,
  onSubmit,
  flushSave,
  syncBodyFromEditor,
  onPickFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onCancelAttachment,
  canSubmit,
  submissionPhase,
  composeOutboundWorkflow,
  approval,
  outboundDisplayPhase,
  submissionError,
  submissionErrorParams,
  submissionIssues,
  buildSubmissionIssueMessageKey,
  onBack,
  onToggleExpand,
  closing = false,
  draftHydrating = false,
  bodyHtmlReaderRef,
}: {
  variant: "embedded-mobile" | "floating-desktop";
  expanded?: boolean;
  contextLoading: boolean;
  composeOptions: Parameters<typeof MailComposeFromSelector>[0]["options"];
  state: ReturnType<typeof useMailComposeDraft>["state"];
  updateField: ReturnType<typeof useMailComposeDraft>["updateField"];
  selectFrom: ReturnType<typeof useMailComposeDraft>["selectFrom"];
  onClose: () => void;
  onDiscard: () => void;
  onSubmit: () => void;
  flushSave: ReturnType<typeof useMailComposeDraft>["flushSave"];
  syncBodyFromEditor: ReturnType<typeof useMailComposeDraft>["syncBodyFromEditor"];
  onPickFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRetryAttachment: (attachmentId: string) => void;
  onCancelAttachment: (attachmentId: string) => void;
  canSubmit: boolean;
  submissionPhase: ReturnType<typeof useMailComposeDraft>["submissionPhase"];
  composeOutboundWorkflow: ReturnType<
    typeof useMailComposeDraft
  >["composeOutboundWorkflow"];
  approval: ReturnType<typeof useMailComposeDraft>["approval"];
  outboundDisplayPhase: ReturnType<
    typeof useMailComposeDraft
  >["outboundDisplayPhase"];
  submissionError: string | null;
  submissionErrorParams?: Record<string, string>;
  submissionIssues: ReturnType<typeof useMailComposeDraft>["submissionIssues"];
  buildSubmissionIssueMessageKey: ReturnType<
    typeof useMailComposeDraft
  >["buildSubmissionIssueMessageKey"];
  onBack?: () => void;
  onToggleExpand?: () => void;
  closing?: boolean;
  draftHydrating?: boolean;
  bodyHtmlReaderRef: React.MutableRefObject<(() => string) | null>;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipBodySyncRef = useRef(false);
  const ccUserOpenedRef = useRef(false);
  const bccUserOpenedRef = useRef(false);
  const [showCcRow, setShowCcRow] = useState(false);
  const [showBccRow, setShowBccRow] = useState(false);
  const [showFormatting, setShowFormatting] = useState(true);
  const [submitTouched, setSubmitTouched] = useState(false);
  const [quotedExpanded, setQuotedExpanded] = useState(false);
  const isMobile = variant === "embedded-mobile";
  const isFloating = variant === "floating-desktop";
  const isEmbeddedExpanded = expanded && !isMobile;
  const emailFieldAppearance = isFloating ? "email" : "form";
  const formattingVisible = (isFloating && !isEmbeddedExpanded) || showFormatting;
  const [showDraftLoadingLabel, setShowDraftLoadingLabel] = useState(false);
  const allLists = buildRecipientLists(state);
  const titleKey = resolveComposeTitleKey(state.composeMode);

  bodyHtmlReaderRef.current = () => editorRef.current?.innerHTML ?? "";

  useEffect(() => {
    if (!draftHydrating) {
      setShowDraftLoadingLabel(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowDraftLoadingLabel(true);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [draftHydrating]);

  useEffect(() => {
    if (skipBodySyncRef.current) {
      skipBodySyncRef.current = false;
      return;
    }
    if (editorRef.current) {
      editorRef.current.innerHTML = state.bodyHtml;
    }
  }, [state.draftId, state.bodyHtml]);

  useEffect(() => {
    if (isFloating) {
      setShowCcRow(state.cc.length > 0);
      setShowBccRow(state.bcc.length > 0);
    } else {
      setShowCcRow(state.cc.length > 0 || state.bcc.length > 0);
      setShowBccRow(state.cc.length > 0 || state.bcc.length > 0);
    }
    ccUserOpenedRef.current = state.cc.length > 0;
    bccUserOpenedRef.current = state.bcc.length > 0;
  }, [isFloating, state.draftId, state.cc.length, state.bcc.length]);

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
    skipBodySyncRef.current = true;
    const html = editorRef.current?.innerHTML ?? "";
    updateField("bodyHtml", html);
  }

  function handleBodyPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");

    if (html.trim()) {
      document.execCommand(
        "insertHTML",
        false,
        normalizeInvisiblePastedForeground(html),
      );
    } else if (text) {
      document.execCommand("insertText", false, text);
    }

    handleBodyInput();
  }

  function handleInsertEmoji(emoji: string) {
    insertTextAtCaret(editorRef.current, emoji);
    handleBodyInput();
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

  const ccBccLinks =
    isFloating && !showCcRow && !showBccRow ? (
      <>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            ccUserOpenedRef.current = true;
            setShowCcRow(true);
          }}
          className="text-xs font-medium tracking-wide crm-text-secondary hover:crm-text"
        >
          CC
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            bccUserOpenedRef.current = true;
            setShowBccRow(true);
          }}
          className="text-xs font-medium tracking-wide crm-text-secondary hover:crm-text"
        >
          BCC
        </button>
      </>
    ) : isFloating && showCcRow && !showBccRow ? (
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          bccUserOpenedRef.current = true;
          setShowBccRow(true);
        }}
        className="text-xs font-medium tracking-wide crm-text-secondary hover:crm-text"
      >
        BCC
      </button>
    ) : isFloating && !showCcRow && showBccRow ? (
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          ccUserOpenedRef.current = true;
          setShowCcRow(true);
        }}
        className="text-xs font-medium tracking-wide crm-text-secondary hover:crm-text"
      >
        CC
      </button>
    ) : null;

  return (
    <div
      className={cn(
        composeMobileRootClass(variant),
        expanded && "mail-compose-embedded-pane-inner mail-compose-embedded-expanded",
      )}
    >
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
            {t(titleKey)}
          </span>
          {saveLabel ? (
            <span className="truncate text-xs crm-text-secondary">{saveLabel}</span>
          ) : null}
        </div>
      ) : (
        <div className="mail-compose-header flex shrink-0 items-center gap-1 border-b crm-border px-2 py-1 sm:px-3">
          <div className="min-w-0 flex-1 truncate px-1 text-sm font-medium crm-text">
            {t(titleKey)}
          </div>
          {saveLabel ? (
            <span className="hidden truncate text-xs crm-text-secondary sm:inline">
              {saveLabel}
            </span>
          ) : null}
          {onToggleExpand ? (
            <button
              type="button"
              onClick={() => {
                skipBodySyncRef.current = true;
                syncBodyFromEditor();
                onToggleExpand();
              }}
              className="mail-compose-toolbar-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
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
          <button
            type="button"
            onClick={onClose}
            disabled={closing}
            className="mail-compose-toolbar-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text disabled:opacity-60 dark:hover:bg-white/[0.06]"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0">
          <MailComposeFromSelector
            options={composeOptions}
            senderIdentityId={state.senderIdentityId}
            mailboxId={state.mailboxId}
            onChange={selectFrom}
            loading={contextLoading}
            appearance={emailFieldAppearance}
          />

          <div className={cn(isFloating ? "px-3" : "space-y-2 px-3 py-2")}>
            <MailRecipientChipsField
              label={t("mail.compose.to")}
              field="to"
              chips={state.to}
              onChange={(chips) => updateField("to", chips)}
              allLists={allLists}
              placeholder={t("mail.recipient.placeholder")}
              trailing={ccBccLinks}
              appearance={emailFieldAppearance}
              compact={isMobile}
              showCcBccToggle={!isFloating && !showCcRow && !showBccRow}
              onToggleCcBcc={() => {
                ccUserOpenedRef.current = true;
                bccUserOpenedRef.current = true;
                setShowCcRow(true);
                setShowBccRow(true);
              }}
            />
            {(isFloating ? showCcRow : showCcRow || showBccRow) ? (
              <MailRecipientChipsField
                label="CC"
                field="cc"
                chips={state.cc}
                onChange={(chips) => updateField("cc", chips)}
                allLists={allLists}
                placeholder={t("mail.recipient.placeholder")}
                appearance={emailFieldAppearance}
                compact={isMobile}
                onFieldFocus={() => {
                  ccUserOpenedRef.current = true;
                }}
                onInputActivity={() => {
                  ccUserOpenedRef.current = true;
                }}
                onFieldBlur={(pendingInput) => {
                  if (
                    ccUserOpenedRef.current &&
                    (pendingInput.trim() || state.cc.length > 0)
                  ) {
                    return;
                  }
                  if (isFloating && state.cc.length === 0 && !pendingInput.trim()) {
                    setShowCcRow(false);
                    ccUserOpenedRef.current = false;
                  }
                }}
              />
            ) : null}
            {(isFloating ? showBccRow : showCcRow || showBccRow) ? (
              <MailRecipientChipsField
                label="BCC"
                field="bcc"
                chips={state.bcc}
                onChange={(chips) => updateField("bcc", chips)}
                allLists={allLists}
                placeholder={t("mail.recipient.placeholder")}
                appearance={emailFieldAppearance}
                compact={isMobile}
                onFieldFocus={() => {
                  bccUserOpenedRef.current = true;
                }}
                onInputActivity={() => {
                  bccUserOpenedRef.current = true;
                }}
                onFieldBlur={(pendingInput) => {
                  if (
                    bccUserOpenedRef.current &&
                    (pendingInput.trim() || state.bcc.length > 0)
                  ) {
                    return;
                  }
                  if (isFloating && state.bcc.length === 0 && !pendingInput.trim()) {
                    setShowBccRow(false);
                    bccUserOpenedRef.current = false;
                  }
                }}
              />
            ) : null}

            <div
              className={cn(
                "flex min-w-0 items-center gap-2",
                isFloating && "border-b crm-border py-1.5",
              )}
            >
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
                  "min-w-0 flex-1 bg-transparent text-sm outline-none crm-text",
                  isFloating
                    ? "min-h-8 border-0 py-0.5"
                    : "min-h-10 rounded-lg border crm-border px-3 mail-compose-input",
                )}
              />
            </div>
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
        </div>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden",
            state.attachments.length > 0 && "mail-compose-body-stack--with-attachments",
          )}
        >
          {!isEmbeddedExpanded && formattingVisible ? (
            <MailFormattingToolbar editorRef={editorRef} compact={isFloating} />
          ) : null}

          <div
            className={cn(
              "mail-compose-body-scroll min-h-0 flex-1 overflow-y-auto",
              isEmbeddedExpanded &&
                "mail-compose-body-region flex min-h-0 flex-1 flex-col overflow-hidden",
            )}
          >
            {isEmbeddedExpanded && showDraftLoadingLabel ? (
              <p className="px-3 pb-1 pt-2 text-xs crm-text-secondary">
                {t("mail.compose.loadingDraft")}
              </p>
            ) : null}

            {isMobile ? (
              <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFormatting((value) => !value)}
                  className="text-xs crm-text-secondary hover:crm-text"
                >
                  {t("mail.compose.formatting")}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 text-xs crm-text-secondary hover:crm-text"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  {t("mail.compose.attachments")}
                </button>
              </div>
            ) : null}

            <div
              className={cn(
                isFloating && !isEmbeddedExpanded ? "px-3 py-2" : isMobile ? "px-3 pb-2" : "",
              )}
            >
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={handleBodyInput}
                onPaste={handleBodyPaste}
                className={cn(
                  "mail-compose-body-editor text-sm outline-none crm-text",
                  isEmbeddedExpanded
                    ? "mail-compose-body-editor--embedded-expanded min-h-full px-3 py-2"
                    : isFloating
                      ? "min-h-[8rem] rounded-md px-1 py-1"
                      : "min-h-[12rem] rounded-lg border crm-border px-3 py-2 mail-compose-input",
                  "empty:before:text-neutral-500 empty:before:content-[attr(data-placeholder)]",
                  "dark:empty:before:text-neutral-400",
                )}
                data-placeholder={t("mail.compose.body")}
              />
            </div>

            {state.quotedBodyHtml ? (
              <div className="px-3 pb-2">
                <button
                  type="button"
                  onClick={() => setQuotedExpanded((value) => !value)}
                  className="inline-flex items-center gap-1 text-sm crm-text-secondary hover:crm-text"
                >
                  {t("mail.compose.showQuoted")}
                </button>
                {quotedExpanded ? (
                  <div
                    className="mail-compose-quoted mt-2 rounded-md border crm-border bg-[var(--color-crm-bg-muted)] px-3 py-2 text-sm leading-relaxed crm-text-secondary"
                    dangerouslySetInnerHTML={{ __html: state.quotedBodyHtml }}
                  />
                ) : null}
              </div>
            ) : null}

            <MailComposeSignatureBlock
              senderIdentityId={state.senderIdentityId}
              compact={isFloating && !isEmbeddedExpanded}
              embeddedExpanded={isEmbeddedExpanded}
            />
          </div>
        </div>
      </div>

      {isEmbeddedExpanded ? (
        <div className="mail-compose-bottom-dock flex shrink-0 flex-col gap-1.5 border-t crm-border px-3 pb-5 pt-2">
          <MailFormattingToolbar editorRef={editorRef} compact dock />
          <MailComposeSubmissionStatus
            phase={submissionPhase}
            approval={approval}
            outboundDisplayPhase={outboundDisplayPhase}
            submissionError={submissionError}
            submissionErrorParams={submissionErrorParams}
            composeOutboundWorkflow={composeOutboundWorkflow}
          />
          {submitTouched && submissionIssues.length > 0 ? (
            <ul className="space-y-1 text-sm text-red-600 dark:text-red-400">
              {submissionIssues.map((issue) => (
                <li key={issue}>{t(buildSubmissionIssueMessageKey(issue))}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={!canSubmit || submissionPhase === "submitting"}
                onClick={() => {
                  setSubmitTouched(true);
                  onSubmit();
                }}
              >
                {t(
                  resolveComposeSubmitButtonLabelKey({
                    submitting: submissionPhase === "submitting",
                    workflow: composeOutboundWorkflow,
                    approvalReturned: approval?.status === "returned",
                  }),
                )}
              </Button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mail-compose-toolbar-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
                aria-label={t("mail.compose.attachments")}
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <MailComposeEmojiPicker onInsert={handleInsertEmoji} />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={confirmDiscard}>
              {t("mail.compose.discardDraft")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mail-compose-footer flex shrink-0 flex-col gap-1.5 border-t crm-border px-3 py-2">
          <MailComposeSubmissionStatus
            phase={submissionPhase}
            approval={approval}
            outboundDisplayPhase={outboundDisplayPhase}
            submissionError={submissionError}
            submissionErrorParams={submissionErrorParams}
            composeOutboundWorkflow={composeOutboundWorkflow}
          />
          {submitTouched && submissionIssues.length > 0 ? (
            <ul className="space-y-1 text-sm text-red-600 dark:text-red-400">
              {submissionIssues.map((issue) => (
                <li key={issue}>{t(buildSubmissionIssueMessageKey(issue))}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            {isFloating ? (
              <>
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canSubmit || submissionPhase === "submitting"}
                    onClick={() => {
                      setSubmitTouched(true);
                      onSubmit();
                    }}
                  >
                    {t(
                      resolveComposeSubmitButtonLabelKey({
                        submitting: submissionPhase === "submitting",
                        workflow: composeOutboundWorkflow,
                        approvalReturned: approval?.status === "returned",
                      }),
                    )}
                  </Button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mail-compose-toolbar-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
                    aria-label={t("mail.compose.attachments")}
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <MailComposeEmojiPicker onInsert={handleInsertEmoji} />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={confirmDiscard}>
                  {t("mail.compose.discardDraft")}
                </Button>
              </>
            ) : (
              <>
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
                  {t(
                    resolveComposeSubmitButtonLabelKey({
                      submitting: submissionPhase === "submitting",
                      workflow: composeOutboundWorkflow,
                      approvalReturned: approval?.status === "returned",
                    }),
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

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
