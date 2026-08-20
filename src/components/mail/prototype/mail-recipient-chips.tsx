"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import {
  emailExistsInLists,
  findDuplicateField,
  isRecipientLimitReached,
  isValidEmail,
  MAX_RECIPIENTS_PER_MESSAGE,
  normalizeEmail,
  parseRecipientTokens,
  remainingRecipientCapacity,
  type RecipientChipData,
  type RecipientLists,
} from "@/lib/mail/prototype/recipient-utils";
import {
  getVisibleRecipientDirectory,
  resolveRecipientMetaForScenario,
} from "@/lib/mail/prototype/recipient-permissions";
import type { RecipientDirectoryEntry } from "@/lib/mail/prototype/recipient-directory";

export function MailRecipientChips({
  label,
  field,
  chips,
  onChange,
  allLists,
  placeholder,
  showCcBccToggle,
  onToggleCcBcc,
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
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { scenario } = useMailPrototype();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [duplicateHint, setDuplicateHint] = useState<string | null>(null);
  const [limitHint, setLimitHint] = useState(false);
  const [suggestions, setSuggestions] = useState<RecipientDirectoryEntry[]>(
    [],
  );
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null);
  const [detailChipId, setDetailChipId] = useState<string | null>(null);

  const buildChip = useCallback(
    (email: string): RecipientChipData => {
      const normalized = normalizeEmail(email);
      const meta = resolveRecipientMetaForScenario(normalized, scenario);
      return {
        id: crypto.randomUUID(),
        email: normalized,
        displayName: meta?.displayName,
        customerId: meta?.customerId,
        customerName: meta?.customerName,
        customerCode: meta?.customerCode,
        crmMismatch: meta?.crmMismatch,
        crmRegisteredEmail: meta?.crmRegisteredEmail,
        sourceKind: meta?.sourceKind,
        multipleCrmMatches: meta?.multipleCrmMatches,
      };
    },
    [scenario],
  );

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

      const chip = buildChip(email);
      onChange([...chips, chip]);
      setInputValue("");
      setInlineError(null);
      setDuplicateHint(null);
      setSuggestions([]);
      setHighlightIndex(-1);
      setSelectedChipId(null);
      setDetailChipId(null);
      return true;
    },
    [allLists, buildChip, chips, field, onChange, t],
  );

  function addFromSuggestion(entry: RecipientDirectoryEntry) {
    addEmail(entry.email);
    inputRef.current?.focus();
  }

  function handleCommitInput() {
    if (!inputValue.trim()) return;
    const tokens = parseRecipientTokens(inputValue);
    if (tokens.length > 1) {
      let remaining = [...tokens];
      let hitLimit = false;
      for (const token of tokens) {
        const before = remainingRecipientCapacity(allLists);
        if (addEmail(token, { silentLimit: true })) {
          remaining = remaining.filter((r) => r !== token);
        } else {
          const after = remainingRecipientCapacity(allLists);
          if (before === after && isValidEmail(token)) {
            hitLimit = true;
          }
          setInputValue(remaining.join(", "));
          if (hitLimit) setLimitHint(true);
          return;
        }
      }
      setInputValue("");
      return;
    }
    addEmail(inputValue);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setSelectedChipId(null);
      setDetailChipId(null);
      setSuggestions([]);
      return;
    }

    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      if (suggestions.length > 0 && highlightIndex >= 0) {
        e.preventDefault();
        addFromSuggestion(suggestions[highlightIndex]!);
        return;
      }
      e.preventDefault();
      handleCommitInput();
      return;
    }

    if (e.key === "Backspace" && !inputValue) {
      e.preventDefault();
      if (selectedChipId) {
        onChange(chips.filter((c) => c.id !== selectedChipId));
        setSelectedChipId(null);
        setDetailChipId(null);
        return;
      }
      if (chips.length > 0) {
        setSelectedChipId(chips[chips.length - 1]!.id);
      }
      return;
    }

    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      selectedChipId &&
      (document.activeElement as HTMLElement | null)?.dataset?.chipId ===
        selectedChipId
    ) {
      e.preventDefault();
      onChange(chips.filter((c) => c.id !== selectedChipId));
      setSelectedChipId(null);
      setDetailChipId(null);
      inputRef.current?.focus();
      return;
    }

    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Escape") {
        setSuggestions([]);
        setHighlightIndex(-1);
      }
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!text.includes(",") && !text.includes(";") && !text.includes("\n")) {
      return;
    }
    e.preventDefault();
    const tokens = parseRecipientTokens(text);
    let hitLimit = false;
    for (const token of tokens) {
      const before = remainingRecipientCapacity(allLists);
      if (!addEmail(token, { silentLimit: true })) {
        const after = remainingRecipientCapacity(allLists);
        if (before === after && isValidEmail(token)) {
          hitLimit = true;
        }
        setInputValue(token);
        break;
      }
    }
    if (hitLimit) setLimitHint(true);
  }

  function handleInputChange(value: string) {
    setInputValue(value);
    setInlineError(null);
    setDuplicateHint(null);
    setLimitHint(false);
    setSelectedChipId(null);
    if (value.trim().length >= 1) {
      setSuggestions(getVisibleRecipientDirectory(scenario, value));
      setHighlightIndex(-1);
    } else {
      setSuggestions([]);
    }
  }

  function removeChip(id: string) {
    onChange(chips.filter((c) => c.id !== id));
    setInlineError(null);
    setDuplicateHint(null);
    if (selectedChipId === id) setSelectedChipId(null);
    if (detailChipId === id) setDetailChipId(null);
  }

  function startEdit(chip: RecipientChipData) {
    onChange(chips.filter((c) => c.id !== chip.id));
    setInputValue(chip.email);
    setSelectedChipId(null);
    setDetailChipId(null);
    inputRef.current?.focus();
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setDetailChipId(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("relative min-w-0 max-w-full", compact ? "space-y-1" : "space-y-1.5")}
    >
      <div
        className={cn(
          "flex min-w-0 max-w-full gap-2",
          compact ? "flex-col items-stretch" : "items-start",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center gap-2",
            compact ? "justify-between" : "pt-2.5",
          )}
        >
          <label htmlFor={inputId} className="text-sm crm-text-secondary">
            {label}
          </label>
          {showCcBccToggle && onToggleCcBcc && (
            <button
              type="button"
              onClick={onToggleCcBcc}
              className="min-h-9 shrink-0 text-sm link-primary"
            >
              Cc/Bcc
            </button>
          )}
        </div>

        <div
          className="min-w-0 max-w-full flex-1"
          onClick={() => inputRef.current?.focus()}
        >
          <div
            className={cn(
              "flex min-h-11 min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-xl border crm-border bg-transparent px-2 py-1.5",
              (inlineError || duplicateHint) && "border-red-400/60",
            )}
          >
            {chips.map((chip) => (
              <RecipientChipBadge
                key={chip.id}
                chip={chip}
                compact={compact}
                selected={selectedChipId === chip.id}
                showDetail={detailChipId === chip.id}
                onSelect={() => {
                  if (selectedChipId === chip.id && !compact) {
                    startEdit(chip);
                    return;
                  }
                  setSelectedChipId(chip.id);
                  if (compact) {
                    setDetailChipId(detailChipId === chip.id ? null : chip.id);
                  }
                }}
                onShowDetail={() => setDetailChipId(chip.id)}
                onHideDetail={() => setDetailChipId(null)}
                onRemove={() => removeChip(chip.id)}
                onEdit={() => startEdit(chip)}
                onKeyActivate={() => {
                  if (selectedChipId === chip.id) {
                    startEdit(chip);
                  } else {
                    setSelectedChipId(chip.id);
                  }
                }}
              />
            ))}
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              inputMode="email"
              autoComplete="off"
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                window.setTimeout(() => {
                  if (inputValue.trim()) handleCommitInput();
                  setSuggestions([]);
                }, 120);
              }}
              onPaste={handlePaste}
              placeholder={chips.length === 0 ? placeholder : undefined}
              className="min-h-9 min-w-[5rem] max-w-full flex-1 border-0 bg-transparent px-1 text-sm outline-none crm-text placeholder:crm-text-secondary"
              style={{ minWidth: 0 }}
            />
          </div>

          {inlineError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
              {inlineError}
            </p>
          )}
          {duplicateHint && !inlineError && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {duplicateHint}
            </p>
          )}
          {limitHint && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400" role="status">
              {t("mail.recipient.limitReached")}
            </p>
          )}

          {suggestions.length > 0 && (
            <ul
              className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border crm-border surface-card py-1 shadow-lg sm:left-auto sm:min-w-[280px]"
              role="listbox"
            >
              {suggestions.map((entry, index) => (
                <li
                  key={`${entry.email}-${entry.customerId ?? entry.kind}`}
                  role="option"
                  aria-selected={index === highlightIndex}
                >
                  <button
                    type="button"
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start px-3 py-2 text-left text-sm",
                      index === highlightIndex ? "nav-active" : "nav-item",
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addFromSuggestion(entry);
                    }}
                  >
                    <span className="font-medium crm-text">
                      {entry.displayName}
                    </span>
                    <span className="break-all text-xs crm-text-secondary">
                      {entry.email}
                      {entry.customerCode ? ` · ${entry.customerCode}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function sourceLabel(
  kind: RecipientChipData["sourceKind"],
  t: (key: string) => string,
): string | null {
  switch (kind) {
    case "customer":
      return t("mail.recipient.sourceCustomer");
    case "contact":
      return t("mail.recipient.sourceContact");
    case "team":
      return t("mail.recipient.sourceTeam");
    case "shared":
      return t("mail.recipient.sourceShared");
    default:
      return null;
  }
}

function RecipientChipBadge({
  chip,
  compact,
  selected,
  showDetail,
  onSelect,
  onShowDetail,
  onHideDetail,
  onRemove,
  onEdit,
  onKeyActivate,
}: {
  chip: RecipientChipData;
  compact: boolean;
  selected: boolean;
  showDetail: boolean;
  onSelect: () => void;
  onShowDetail: () => void;
  onHideDetail: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onKeyActivate: () => void;
}) {
  const { t } = useTranslation();
  const chipLabel = chip.displayName ?? chip.email;

  return (
    <div className="relative min-w-0 max-w-full">
      <span
        role="button"
        tabIndex={0}
        data-chip-id={chip.id}
        onClick={onSelect}
        onFocus={onShowDetail}
        onMouseEnter={!compact ? onShowDetail : undefined}
        onMouseLeave={!compact ? onHideDetail : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onKeyActivate();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onHideDetail();
          }
        }}
        className={cn(
          "inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg px-2 py-1 text-xs",
          chip.customerId || chip.multipleCrmMatches
            ? "bg-blue-500/10 text-blue-800 dark:text-blue-200"
            : "bg-black/5 crm-text dark:bg-white/10",
          selected && "ring-2 ring-blue-500/50",
        )}
      >
        <span className="min-w-0 truncate" title={chip.email}>
          {chipLabel}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10"
          aria-label={t("mail.recipient.remove")}
        >
          <X className="h-3 w-3" />
        </button>
      </span>

      {chip.customerName && !chip.crmMismatch && !chip.multipleCrmMatches && (
        <span className="mt-0.5 block max-w-full truncate text-[10px] text-blue-600 dark:text-blue-300">
          {t("mail.recipient.crmMatch", { name: chip.customerName })}
        </span>
      )}
      {chip.multipleCrmMatches && chip.multipleCrmMatches.length > 0 && (
        <span className="mt-0.5 block max-w-full text-[10px] text-amber-600 dark:text-amber-400">
          {t("mail.recipient.multipleCrmMatches")}
        </span>
      )}
      {chip.crmMismatch && chip.crmRegisteredEmail && (
        <span className="mt-0.5 block max-w-full text-[10px] text-amber-600 dark:text-amber-400">
          {t("mail.recipient.crmMismatch", {
            registered: chip.crmRegisteredEmail,
          })}
        </span>
      )}

      {showDetail && (
        <div
          className={cn(
            "absolute left-0 z-30 mt-1 w-max max-w-[min(100vw-2rem,280px)] rounded-xl border crm-border surface-card p-3 text-xs shadow-lg",
            compact ? "top-full" : "top-full",
          )}
          onMouseEnter={!compact ? onShowDetail : undefined}
          onMouseLeave={!compact ? onHideDetail : undefined}
        >
          {chip.displayName && (
            <p className="font-medium crm-text">{chip.displayName}</p>
          )}
          <p className="break-all crm-text-secondary">{chip.email}</p>
          {chip.customerCode && (
            <p className="crm-text-secondary">{chip.customerCode}</p>
          )}
          {chip.sourceKind && (
            <p className="mt-1 crm-text-secondary">
              {sourceLabel(chip.sourceKind, t)}
            </p>
          )}
          {compact ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="min-h-9 rounded-lg px-2 text-sm link-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                {t("mail.recipient.edit")}
              </button>
              <button
                type="button"
                className="min-h-9 rounded-lg px-2 text-sm text-red-600 dark:text-red-400"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              >
                {t("mail.recipient.remove")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="mt-2 min-h-8 text-sm link-primary"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              {t("mail.recipient.edit")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { MAX_RECIPIENTS_PER_MESSAGE };
