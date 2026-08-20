"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Paperclip,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { Button } from "@/components/ui/button";
import { MailFormattingToolbar } from "./mail-formatting-toolbar";
import { MailSignaturePreview } from "./mail-signature-preview";
import { MailRecipientChips } from "./mail-recipient-chips";
import { MailFromSelector } from "./mail-from-selector";
import {
  chipsToEmails,
  initChipsFromDraft,
  type RecipientChipData,
} from "@/lib/mail/prototype/recipient-utils";
import { resolveRecipientMetaForScenario } from "@/lib/mail/prototype/recipient-permissions";
import type { MockComposeDraft } from "@/lib/mail/prototype/state";
import type { MailSensitivity } from "@/lib/mail/prototype/types";
import { shouldShowReplyAllWarning } from "@/lib/mail/prototype/message-actions";
import {
  canSelectRestrictedSensitivity,
  detectSensitiveAttachmentHint,
} from "@/lib/mail/prototype/sensitivity";
import { MailCustomerAssociationPicker } from "./mail-customer-association-picker";
import { MailTemplatePicker } from "./mail-template-picker";
import { formatHongKongDateTime } from "@/lib/timezone";

export type ComposeDraft = MockComposeDraft;

const MOCK_ATTACHMENTS = [
  { name: "Passport.pdf", size: "1.8 MB", kind: "attachment" as const },
  { name: "Bank Documents.zip", size: "86 MB", kind: "secure_file" as const },
];

const SAVE_DEBOUNCE_MS = 700;

export function MailCompose({
  variant,
  onBack,
  onClose,
  onToggleExpand,
  expanded = false,
}: {
  variant: "embedded-mobile" | "floating-desktop";
  onBack?: () => void;
  onClose?: () => void;
  onToggleExpand?: () => void;
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const {
    isAdminScenario,
    isStaffScenario,
    scenario,
    submitForApproval,
    adminSend,
    composeDraft,
    updateComposeDraft,
    markComposeSaving,
    markComposeSaved,
    clearComposeDraft,
    persistComposeDraftOnClose,
    composeSaveStatus,
    composeSavedAt,
  } = useMailPrototype();

  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const hydratedRef = useRef(false);
  const isMobile = variant === "embedded-mobile";
  const isFloating = variant === "floating-desktop";

  const [from, setFrom] = useState(composeDraft?.from ?? "");
  const [toChips, setToChips] = useState<RecipientChipData[]>([]);
  const [ccChips, setCcChips] = useState<RecipientChipData[]>([]);
  const [bccChips, setBccChips] = useState<RecipientChipData[]>([]);
  const [subject, setSubject] = useState(composeDraft?.subject ?? "");
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [showCcBcc, setShowCcBcc] = useState(isFloating);
  const [showMobileFormatting, setShowMobileFormatting] = useState(false);
  const [showDesktopFormatting, setShowDesktopFormatting] = useState(false);
  const [bodyVersion, setBodyVersion] = useState(0);
  const [mockAttachments, setMockAttachments] = useState<typeof MOCK_ATTACHMENTS>(
    [],
  );
  const [sensitivity, setSensitivity] = useState<MailSensitivity>("normal");
  const [customerAssociation, setCustomerAssociation] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showQuoted, setShowQuoted] = useState(false);
  const [selectedForwardIds, setSelectedForwardIds] = useState<string[]>([]);
  const [noCustomerEmailHint, setNoCustomerEmailHint] = useState(false);

  const dismissCompose = onClose ?? onBack ?? (() => {});

  useEffect(() => {
    if (!composeDraft || hydratedRef.current) return;
    const lookup = (email: string) =>
      resolveRecipientMetaForScenario(email, scenario);
    setFrom(composeDraft.from);
    setToChips(initChipsFromDraft(composeDraft.to, lookup));
    setCcChips(initChipsFromDraft(composeDraft.cc, lookup));
    setBccChips(initChipsFromDraft(composeDraft.bcc, lookup));
    setSubject(composeDraft.subject);
    setShowCcBcc(
      isFloating ||
        composeDraft.cc.length > 0 ||
        composeDraft.bcc.length > 0,
    );
    if (editorRef.current) {
      editorRef.current.innerHTML = composeDraft.body;
    }
    setSensitivity(composeDraft.sensitivity ?? "normal");
    setCustomerAssociation(composeDraft.customerAssociation ?? null);
    setSelectedForwardIds(composeDraft.selectedForwardAttachmentIds ?? []);
    setNoCustomerEmailHint(
      Boolean(
        composeDraft.customerAssociation &&
          composeDraft.to.length === 0,
      ),
    );
    hydratedRef.current = true;
  }, [composeDraft, scenario, isFloating]);

  useEffect(() => {
    if (!hydratedRef.current) return;

    markComposeSaving();
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      updateComposeDraft({
        from,
        to: chipsToEmails(toChips),
        cc: chipsToEmails(ccChips),
        bcc: chipsToEmails(bccChips),
        subject,
        body: editorRef.current?.innerHTML ?? "",
        sensitivity,
        customerAssociation,
        selectedForwardAttachmentIds: selectedForwardIds,
        mockAttachmentCount: mockAttachments.length,
      });
      markComposeSaved();
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [
    from,
    toChips,
    ccChips,
    bccChips,
    subject,
    bodyVersion,
    sensitivity,
    customerAssociation,
    selectedForwardIds,
    mockAttachments.length,
    markComposeSaving,
    markComposeSaved,
    updateComposeDraft,
  ]);

  if (!composeDraft) return null;

  const allLists = { to: toChips, cc: ccChips, bcc: bccChips };

  function getBodyText(): string {
    return editorRef.current?.innerText?.trim() ?? "";
  }

  function flushDraft() {
    updateComposeDraft({
      from,
      to: chipsToEmails(toChips),
      cc: chipsToEmails(ccChips),
      bcc: chipsToEmails(bccChips),
      subject,
      body: editorRef.current?.innerHTML ?? "",
      sensitivity,
      customerAssociation,
      selectedForwardAttachmentIds: selectedForwardIds,
      mockAttachmentCount: mockAttachments.length,
    });
  }

  function handleSubmit() {
    const body = getBodyText();
    const to = chipsToEmails(toChips);
    setSubjectTouched(true);
    if (to.length === 0 || !subject.trim()) return;

    const cc = chipsToEmails(ccChips);
    const bcc = chipsToEmails(bccChips);

    const payload = {
      from,
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      subject,
      body,
      sensitivity,
      approvalMessageId: composeDraft!.approvalMessageId,
      adminEdited:
        composeDraft!.mode === "edit_approval"
          ? true
          : composeDraft!.adminEdited,
    };

    if (isAdminScenario) {
      adminSend(payload);
    } else {
      submitForApproval({ ...payload, replyToId: composeDraft?.replyToId });
    }
    clearComposeDraft();
    dismissCompose();
  }

  function handleClose() {
    flushDraft();
    markComposeSaved();
    persistComposeDraftOnClose();
    dismissCompose();
  }

  function handleDiscard() {
    if (!window.confirm(t("mail.compose.discardConfirm"))) {
      return;
    }
    clearComposeDraft();
    dismissCompose();
  }

  const subjectEmpty = !subject.trim();
  const showSubjectError = subjectTouched && subjectEmpty;
  const canSubmit = toChips.length > 0 && !subjectEmpty;
  const isReply =
    composeDraft.mode === "reply" || composeDraft.mode === "reply_all";
  const composeTitle =
    composeDraft.mode === "forward"
      ? t("mail.compose.forward")
      : composeDraft.mode === "reply_all"
        ? t("mail.compose.replyAll")
        : composeDraft.mode === "edit_approval"
          ? t("mail.approval.editAndSend")
          : isReply
            ? t("mail.compose.reply")
            : t("mail.compose.new");
  const replyAllWarning = shouldShowReplyAllWarning(
    chipsToEmails(toChips),
    chipsToEmails(ccChips),
  );
  const forwardFiles = composeDraft.forwardAttachments ?? [];
  const allAttachmentNames = [
    ...mockAttachments.map((a) => a.name),
    ...forwardFiles.map((a) => a.name),
  ];
  const sensitiveAttachmentHint =
    detectSensitiveAttachmentHint(allAttachmentNames);
  const savedTimeLabel =
    composeSavedAt &&
    new Date(composeSavedAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  const saveLabel =
    composeSaveStatus === "saving"
      ? t("mail.compose.saving")
      : composeSaveStatus === "saved" && savedTimeLabel
        ? t("mail.compose.savedAt", { time: savedTimeLabel })
        : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {isFloating ? (
        <div className="flex shrink-0 items-center gap-1 border-b crm-border px-2 py-1.5 sm:px-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
            aria-label={
              expanded
                ? t("mail.compose.restore")
                : t("mail.compose.expand")
            }
          >
            {expanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-md crm-text-secondary opacity-50"
              aria-label="Undo"
              disabled
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-md crm-text-secondary opacity-50"
              aria-label="Redo"
              disabled
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              aria-label={t("mail.compose.addMockAttachments")}
              onClick={() => setMockAttachments([...MOCK_ATTACHMENTS])}
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowDesktopFormatting((v) => !v)}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md text-sm font-semibold",
                showDesktopFormatting
                  ? "mail-nav-active"
                  : "crm-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
              )}
              aria-expanded={showDesktopFormatting}
              aria-label={t("mail.compose.formatting")}
            >
              Aa
            </button>
            <MailTemplatePicker
              subject={composeDraft?.subject ?? ""}
              onInsert={(tpl, applySubject) => {
                updateComposeDraft({
                  body: (composeDraft?.body ?? "") + tpl.body,
                  subject: applySubject && tpl.subject ? tpl.subject : composeDraft?.subject,
                });
                if (editorRef.current && tpl.body) {
                  editorRef.current.innerText =
                    (editorRef.current.innerText ?? "") + tpl.body;
                }
              }}
              className="flex h-9 items-center px-1"
            />
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              aria-label="More"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {saveLabel && (
              <span className="hidden text-[11px] crm-text-secondary sm:inline">
                {saveLabel}
              </span>
            )}
            <Button
              type="button"
              size="sm"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {isAdminScenario
                ? t("mail.compose.send")
                : t("mail.compose.submitApproval")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b crm-border px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="flex min-h-10 shrink-0 items-center gap-1 text-sm crm-text"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span className="truncate">{t("mail.compose.backToMail")}</span>
            </button>
          </div>
          <div className="flex min-w-0 flex-col items-end gap-0.5">
            <h3 className="truncate text-sm font-semibold crm-text sm:text-base">
              {composeTitle}
            </h3>
            <p className="text-[11px] crm-text-secondary" aria-live="polite">
              {saveLabel}
            </p>
          </div>
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4">
        {composeDraft.mode === "edit_approval" && composeDraft.submittedByName && (
          <p className="text-xs crm-text-secondary">
            {t("mail.approval.submittedByLabel", {
              name: composeDraft.submittedByName,
            })}
          </p>
        )}
        {customerAssociation && (
          <MailCustomerAssociationPicker
            value={customerAssociation}
            onChange={setCustomerAssociation}
          />
        )}
        {noCustomerEmailHint && (
          <p className="text-xs crm-text-secondary">
            {t("mail.association.noCustomerEmail")}
          </p>
        )}
        <MailRecipientChips
          label={t("mail.compose.to")}
          field="to"
          chips={toChips}
          onChange={setToChips}
          allLists={allLists}
          placeholder={t("mail.recipient.placeholder")}
          showCcBccToggle={!showCcBcc && isMobile}
          onToggleCcBcc={() => setShowCcBcc(true)}
          compact={isMobile}
        />

        {replyAllWarning && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {t("mail.compose.replyAllWarning")}
          </p>
        )}

        {showCcBcc && (
          <>
            <MailRecipientChips
              label="Cc"
              field="cc"
              chips={ccChips}
              onChange={setCcChips}
              allLists={allLists}
              placeholder={t("mail.recipient.placeholder")}
              compact={isMobile}
            />
            <MailRecipientChips
              label="Bcc"
              field="bcc"
              chips={bccChips}
              onChange={setBccChips}
              allLists={allLists}
              placeholder={t("mail.recipient.placeholder")}
              compact={isMobile}
            />
          </>
        )}

        <ComposeField label={t("mail.compose.from")} compact={isMobile}>
          {isFloating ? (
            <MailFromSelector value={from} onChange={setFrom} />
          ) : (
            <MobileFromField from={from} onChange={setFrom} />
          )}
        </ComposeField>

        <ComposeField label={t("mail.compose.subject")} compact={isMobile}>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={() => setSubjectTouched(true)}
            className={cn(
              "min-h-10 w-full max-w-full rounded-md border crm-border bg-transparent px-3 text-sm crm-text",
              showSubjectError && "border-red-400/60",
            )}
            aria-invalid={showSubjectError}
          />
          {showSubjectError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
              {t("mail.recipient.subjectRequired")}
            </p>
          )}
        </ComposeField>

        <ComposeField label={t("mail.sensitivity.label")} compact={isMobile}>
          <select
            value={sensitivity}
            onChange={(e) => setSensitivity(e.target.value as MailSensitivity)}
            className="min-h-10 w-full rounded-md border crm-border bg-transparent px-3 text-sm crm-text"
          >
            <option value="normal">{t("mail.sensitivity.normal")}</option>
            <option value="sensitive">{t("mail.sensitivity.sensitive")}</option>
            {canSelectRestrictedSensitivity(scenario) && (
              <option value="restricted">
                {t("mail.sensitivity.restricted")}
              </option>
            )}
          </select>
        </ComposeField>

        {isFloating && <hr className="crm-border" />}

        <div className="min-w-0 overflow-hidden rounded-md border crm-border">
          {isMobile ? (
            <div className="flex items-center justify-between border-b crm-border px-3 py-2">
              <span className="text-sm crm-text-secondary">
                {t("mail.compose.body")}
              </span>
              <button
                type="button"
                onClick={() => setShowMobileFormatting((v) => !v)}
                className={cn(
                  "flex min-h-10 min-w-10 items-center justify-center rounded-xl text-sm font-semibold",
                  showMobileFormatting ? "nav-active" : "nav-item",
                )}
                aria-expanded={showMobileFormatting}
                aria-label={t("mail.compose.formatting")}
              >
                Aa
              </button>
            </div>
          ) : (
            showDesktopFormatting && (
              <MailFormattingToolbar editorRef={editorRef} />
            )
          )}
          {isMobile && showMobileFormatting && (
            <MailFormattingToolbar
              editorRef={editorRef}
              className="max-w-full overflow-x-auto"
            />
          )}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={() => setBodyVersion((v) => v + 1)}
            className={cn(
              "max-w-full px-3 py-3 text-sm outline-none crm-text",
              isMobile
                ? "min-h-[140px] max-h-[min(40vh,280px)] overflow-y-auto"
                : isFloating && expanded
                  ? "min-h-[240px] flex-1 overflow-y-auto"
                  : "min-h-[160px] max-h-[min(36vh,320px)] overflow-y-auto",
            )}
          />
        </div>

        {composeDraft.quotedOriginal && (
          <details
            open={showQuoted}
            onToggle={(e) => setShowQuoted(e.currentTarget.open)}
            className="rounded-md border crm-border px-3 py-2 text-sm"
          >
            <summary className="cursor-pointer crm-text-secondary">
              {t("mail.compose.showQuoted")}
            </summary>
            <div className="mt-2 space-y-1 text-xs crm-text-secondary">
              <p>
                {composeDraft.quotedOriginal.fromName} &lt;
                {composeDraft.quotedOriginal.fromEmail}&gt;
              </p>
              <p>
                {formatHongKongDateTime(composeDraft.quotedOriginal.sentAt)}
              </p>
              <p>{composeDraft.quotedOriginal.subject}</p>
              <p className="whitespace-pre-wrap crm-text">
                {composeDraft.quotedOriginal.body}
              </p>
            </div>
          </details>
        )}

        <div
          className="min-w-0 rounded-md border border-dashed crm-border px-4 py-4 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setMockAttachments([...MOCK_ATTACHMENTS]);
          }}
        >
          <p className="text-sm crm-text-secondary">
            {t("mail.compose.dropAttachments")}
          </p>
          {!isFloating && (
            <button
              type="button"
              className="mt-2 min-h-10 text-sm link-primary"
              onClick={() => setMockAttachments([...MOCK_ATTACHMENTS])}
            >
              {t("mail.compose.addMockAttachments")}
            </button>
          )}
        </div>

        {forwardFiles.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium crm-text">
              {t("mail.compose.forwardAttachments")}
            </p>
            <ul className="divide-y crm-border">
              {forwardFiles.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedForwardIds.includes(a.id)}
                    onChange={(e) => {
                      setSelectedForwardIds((prev) =>
                        e.target.checked
                          ? [...prev, a.id]
                          : prev.filter((id) => id !== a.id),
                      );
                    }}
                  />
                  <span className="crm-text">{a.name}</span>
                  <span className="text-xs crm-text-secondary">{a.sizeLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mockAttachments.length > 0 && (
          <ul className="min-w-0 divide-y crm-border">
            {mockAttachments.map((a) => (
              <li
                key={a.name}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0"
              >
                <span className="min-w-0 truncate crm-text">{a.name}</span>
                <span className="shrink-0 text-xs crm-text-secondary">
                  {a.size}
                  {a.kind === "secure_file" &&
                    ` · ${t("mail.attachment.secureFile")}`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {sensitiveAttachmentHint && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {t("mail.sensitivity.attachmentHint")}
          </p>
        )}

        <MailSignaturePreview isStaff={isStaffScenario} />
      </div>

      {!isFloating && (
        <div className="shrink-0 border-t crm-border px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleDiscard}>
              {t("mail.compose.discardDraft")}
            </Button>
            <Button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {isAdminScenario
                ? t("mail.compose.send")
                : t("mail.compose.submitApproval")}
            </Button>
          </div>
        </div>
      )}

      {isFloating && (
        <div className="flex shrink-0 justify-end border-t crm-border px-3 py-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleDiscard}>
            {t("mail.compose.discardDraft")}
          </Button>
        </div>
      )}
    </div>
  );
}

function MobileFromField({
  from,
  onChange,
}: {
  from: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const { mailboxes } = useMailPrototype();
  const personal = mailboxes.filter((m) => m.label === "personal");
  const shared = mailboxes.filter((m) => m.label === "shared");

  if (mailboxes.length <= 1) {
    return <p className="min-h-10 break-all py-2 text-sm crm-text">{from}</p>;
  }

  return (
    <select
      value={from}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-10 w-full max-w-full rounded-xl border crm-border bg-transparent px-3 text-sm crm-text"
    >
      {personal.length > 0 && (
        <optgroup label={t("mail.mailbox.personal")}>
          {personal.map((m) => (
            <option key={m.address} value={m.address}>
              {m.address}
            </option>
          ))}
        </optgroup>
      )}
      {shared.length > 0 && (
        <optgroup label={t("mail.mailbox.shared")}>
          {shared.map((m) => (
            <option key={m.address} value={m.address}>
              {m.address}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function ComposeField({
  label,
  children,
  compact,
}: {
  label: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="min-w-0 space-y-1">
        <span className="text-sm crm-text-secondary">{label}</span>
        <div className="min-w-0">{children}</div>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-[4rem_1fr] items-start gap-2 sm:grid-cols-[5rem_1fr]">
      <span className="pt-2.5 text-sm crm-text-secondary">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
