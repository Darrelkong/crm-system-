"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import {
  emailExistsInLists,
  findDuplicateField,
  isRecipientLimitReached,
  isValidEmail,
  normalizeEmail,
  parseRecipientTokens,
  remainingRecipientCapacity,
  type RecipientChipData,
  type RecipientLists,
} from "@/lib/mail/client/recipient-input";

export function MailRecipientChipsField({
  label,
  field,
  chips,
  onChange,
  allLists,
  placeholder,
  showCcBccToggle,
  onToggleCcBcc,
  trailing,
  appearance = "form",
  onFieldBlur,
  onFieldFocus,
  onInputActivity,
  compact = false,
}: {
  label: string;
  field: "to" | "cc" | "bcc";
  chips: RecipientChipData[];
  onChange: (chips: RecipientChipData[]) => void;
  allLists: RecipientLists;
  placeholder?: string;
  showCcBccToggle?: boolean;
  onToggleCcBcc?: () => void;
  trailing?: ReactNode;
  appearance?: "form" | "email";
  onFieldBlur?: (pendingInput: string) => void;
  onFieldFocus?: () => void;
  onInputActivity?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [duplicateHint, setDuplicateHint] = useState<string | null>(null);
  const [limitHint, setLimitHint] = useState(false);

  const buildChip = useCallback((email: string): RecipientChipData => {
    return {
      id: crypto.randomUUID(),
      email: normalizeEmail(email),
    };
  }, []);

  const addEmail = useCallback(
    (raw: string, options?: { silentLimit?: boolean }) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setInlineError(null);
        setDuplicateHint(null);
        return true;
      }

      if (!isValidEmail(trimmed)) {
        setInlineError(t("mail.recipient.invalidFormat"));
        setDuplicateHint(null);
        return false;
      }

      const email = normalizeEmail(trimmed);
      const dupField = findDuplicateField(email, field, allLists);
      if (dupField) {
        setDuplicateHint(t("mail.recipient.duplicate"));
        setInlineError(null);
        return false;
      }

      if (
        !emailExistsInLists(email, allLists) &&
        isRecipientLimitReached(allLists)
      ) {
        if (!options?.silentLimit) {
          setLimitHint(true);
        }
        setInlineError(null);
        setDuplicateHint(null);
        return false;
      }

      onChange([...chips, buildChip(email)]);
      setInputValue("");
      setInlineError(null);
      setDuplicateHint(null);
      setLimitHint(false);
      return true;
    },
    [allLists, buildChip, chips, field, onChange, t],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === ";") {
      event.preventDefault();
      addEmail(inputValue);
      return;
    }
    if (event.key === "Backspace" && !inputValue && chips.length > 0) {
      onChange(chips.slice(0, -1));
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!text.includes(",") && !text.includes(";") && !text.includes("\n")) {
      return;
    }
    event.preventDefault();
    const tokens = parseRecipientTokens(text);
    let next = [...chips];
    for (const token of tokens) {
      if (!isValidEmail(token)) continue;
      const email = normalizeEmail(token);
      if (next.some((chip) => normalizeEmail(chip.email) === email)) continue;
      if (
        countFieldRecipients(allLists, field, next) >=
        remainingRecipientCapacity(allLists) + countFieldRecipients(allLists, field, chips)
      ) {
        setLimitHint(true);
        break;
      }
      next = [...next, buildChip(email)];
    }
    onChange(next);
    setInputValue("");
    setInlineError(null);
    setDuplicateHint(null);
  }

  function removeChip(chipId: string) {
    onChange(chips.filter((chip) => chip.id !== chipId));
  }

  const isEmailAppearance = appearance === "email";

  return (
    <div className={cn("min-w-0", compact ? "space-y-0.5" : "space-y-1")}>
      <div className="flex min-w-0 items-start gap-2">
        <label
          htmlFor={inputId}
          className={cn(
            "w-12 shrink-0 text-sm crm-text-secondary",
            isEmailAppearance ? "pt-1.5" : "pt-2",
          )}
        >
          {label}
        </label>
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-wrap items-center gap-1",
            isEmailAppearance
              ? "min-h-8 border-b crm-border px-0 py-0.5"
              : "min-h-10 rounded-lg border crm-border px-2 py-1",
            inlineError && !isEmailAppearance && "border-red-400",
            inlineError && isEmailAppearance && "border-b-red-400",
          )}
          onClick={() => inputRef.current?.focus()}
        >
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-black/[0.06] px-2 py-0.5 text-sm dark:bg-white/[0.08]"
            >
              <span className="truncate">{chip.displayName ?? chip.email}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeChip(chip.id);
                }}
                className="rounded p-0.5 crm-text-secondary hover:crm-text"
                aria-label={t("mail.recipient.remove")}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            inputMode="email"
            autoComplete="off"
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value);
              onInputActivity?.();
              setInlineError(null);
              setDuplicateHint(null);
              setLimitHint(false);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => onFieldFocus?.()}
            onBlur={() => {
              if (inputValue.trim()) {
                addEmail(inputValue);
              }
              onFieldBlur?.(inputValue);
            }}
            placeholder={chips.length === 0 ? placeholder : undefined}
            className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm crm-text outline-none"
          />
        </div>
        {trailing ? (
          <div className="flex shrink-0 items-center gap-2 self-center">{trailing}</div>
        ) : null}
        {showCcBccToggle && onToggleCcBcc ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onToggleCcBcc}
            className="shrink-0 pt-2 text-xs crm-text-secondary hover:crm-text"
          >
            CC / BCC
          </button>
        ) : null}
      </div>
      {inlineError ? (
        <p
          className={cn(
            "text-xs text-red-600 dark:text-red-400",
            isEmailAppearance ? "pl-14" : "pl-14",
          )}
        >
          {inlineError}
        </p>
      ) : null}
      {duplicateHint ? (
        <p className="pl-14 text-xs crm-text-secondary">{duplicateHint}</p>
      ) : null}
      {limitHint ? (
        <p className="pl-14 text-xs text-amber-600 dark:text-amber-400">
          {t("mail.recipient.limitReached")}
        </p>
      ) : null}
    </div>
  );
}

function countFieldRecipients(
  allLists: RecipientLists,
  field: "to" | "cc" | "bcc",
  nextFieldChips: RecipientChipData[],
): number {
  const merged: RecipientLists = {
    to: field === "to" ? nextFieldChips : allLists.to,
    cc: field === "cc" ? nextFieldChips : allLists.cc,
    bcc: field === "bcc" ? nextFieldChips : allLists.bcc,
  };
  const seen = new Set<string>();
  for (const list of [merged.to, merged.cc, merged.bcc]) {
    for (const chip of list) {
      seen.add(normalizeEmail(chip.email));
    }
  }
  return seen.size;
}
