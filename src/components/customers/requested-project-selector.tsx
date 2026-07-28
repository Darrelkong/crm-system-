"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import type { Locale } from "@/i18n/config";
import {
  REQUESTED_PROJECT_GROUPS,
  getItemsForGroup,
  getRequestedProjectGroup,
  getRequestedProjectItem,
  isRequestedProjectOtherCode,
  searchRequestedProjectItems,
  searchRequestedProjectItemsInGroup,
  type RequestedProjectGroup,
  type RequestedProjectGroupCode,
  type RequestedProjectItem,
  type RequestedProjectLocale,
} from "@/lib/constants/requested-projects";

export type RequestedProjectSelectorProps = {
  id?: string;
  locale: Locale;
  valueCode: string | null;
  /** Used for legacy / other closed-trigger display. */
  valueName: string;
  disabled?: boolean;
  placeholder: string;
  selectServiceTitle: string;
  selectCountryTitle: string;
  searchPlaceholder: string;
  backLabel: string;
  closeLabel: string;
  onSelect: (next: { code: string }) => void;
  className?: string;
};

function toProjectLocale(locale: Locale): RequestedProjectLocale {
  return locale;
}

function useIsDesktopDualPane(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

export function RequestedProjectSelector({
  id,
  locale,
  valueCode,
  valueName,
  disabled,
  placeholder,
  selectServiceTitle,
  selectCountryTitle,
  searchPlaceholder,
  backLabel,
  closeLabel,
  onSelect,
  className,
}: RequestedProjectSelectorProps) {
  const projectLocale = toProjectLocale(locale);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"groups" | "items">("groups");
  const [activeGroup, setActiveGroup] =
    useState<RequestedProjectGroupCode | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const desktop = useIsDesktopDualPane();
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const triggerLabel = useMemo(() => {
    if (!valueCode) {
      return valueName.trim() || "";
    }
    if (isRequestedProjectOtherCode(valueCode)) {
      return valueName.trim() || "";
    }
    const item = getRequestedProjectItem(valueCode);
    if (!item) {
      return valueName.trim() || "";
    }
    return item.labels[projectLocale];
  }, [valueCode, valueName, projectLocale]);

  const resetOpenState = useCallback(() => {
    setStep("groups");
    setActiveGroup(null);
    setQuery("");
    setHighlight(0);
  }, []);

  const openSelector = () => {
    if (disabled) return;
    resetOpenState();
    if (desktop && valueCode) {
      const item = getRequestedProjectItem(valueCode);
      if (item) {
        setActiveGroup(item.groupCode);
      }
    }
    setOpen(true);
  };

  const closeSelector = () => {
    setOpen(false);
    resetOpenState();
  };

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, step, activeGroup]);

  const groupLabel = (group: RequestedProjectGroup) =>
    group.labels[projectLocale];
  const itemLabel = (item: RequestedProjectItem) => item.labels[projectLocale];

  const enterGroup = (group: RequestedProjectGroup) => {
    setActiveGroup(group.groupCode);
    setStep("items");
    setQuery("");
    setHighlight(0);
  };

  const goBackToGroups = () => {
    setStep("groups");
    setActiveGroup(null);
    setQuery("");
    setHighlight(0);
  };

  const commitItem = (item: RequestedProjectItem) => {
    onSelect({ code: item.code });
    closeSelector();
  };

  const globalHits = useMemo(() => {
    if (!query.trim()) return [];
    if (desktop) {
      if (activeGroup) {
        return searchRequestedProjectItemsInGroup(activeGroup, query).map(
          (item) => ({
            item,
            group: getRequestedProjectGroup(item.groupCode)!,
          }),
        );
      }
      return searchRequestedProjectItems(query);
    }
    if (step === "groups") {
      return searchRequestedProjectItems(query);
    }
    if (activeGroup) {
      return searchRequestedProjectItemsInGroup(activeGroup, query).map(
        (item) => ({
          item,
          group: getRequestedProjectGroup(item.groupCode)!,
        }),
      );
    }
    return [];
  }, [query, desktop, activeGroup, step]);

  const level2Items = useMemo(() => {
    if (!activeGroup) return [];
    if (query.trim()) {
      return searchRequestedProjectItemsInGroup(activeGroup, query);
    }
    return getItemsForGroup(activeGroup);
  }, [activeGroup, query]);

  type KbRow =
    | { kind: "group"; group: RequestedProjectGroup }
    | { kind: "item"; item: RequestedProjectItem };

  const kbRows: KbRow[] = useMemo(() => {
    if (desktop) {
      if (query.trim()) {
        return globalHits.map((h) => ({ kind: "item" as const, item: h.item }));
      }
      if (activeGroup) {
        return level2Items.map((item) => ({ kind: "item" as const, item }));
      }
      return REQUESTED_PROJECT_GROUPS.map((group) => ({
        kind: "group" as const,
        group,
      }));
    }
    if (step === "groups") {
      if (query.trim()) {
        return globalHits.map((h) => ({ kind: "item" as const, item: h.item }));
      }
      return REQUESTED_PROJECT_GROUPS.map((group) => ({
        kind: "group" as const,
        group,
      }));
    }
    return level2Items.map((item) => ({ kind: "item" as const, item }));
  }, [desktop, query, globalHits, activeGroup, level2Items, step]);

  useEffect(() => {
    setHighlight(0);
  }, [kbRows.length, step, activeGroup, query]);

  const onKeyDownList = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!desktop && step === "items") {
        goBackToGroups();
        return;
      }
      closeSelector();
      return;
    }
    if (kbRows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % kbRows.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h - 1 + kbRows.length) % kbRows.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = kbRows[highlight];
      if (!row) return;
      if (row.kind === "group") enterGroup(row.group);
      else commitItem(row.item);
    }
  };

  const selectedGroupCode = useMemo(() => {
    if (!valueCode) return null;
    return getRequestedProjectItem(valueCode)?.groupCode ?? null;
  }, [valueCode]);

  const headerTitle = (() => {
    if (desktop) return selectServiceTitle;
    if (step === "items" && activeGroup) {
      const g = getRequestedProjectGroup(activeGroup);
      return g ? groupLabel(g) : selectCountryTitle;
    }
    return selectCountryTitle;
  })();

  const renderItemButton = (
    item: RequestedProjectItem,
    index: number,
    withBreadcrumb: boolean,
  ) => {
    const selected = valueCode === item.code;
    const group = getRequestedProjectGroup(item.groupCode)!;
    return (
      <li key={item.code}>
        <button
          type="button"
          role="option"
          aria-selected={selected}
          className={cn(
            "project-selector-row",
            selected && "is-selected",
            highlight === index && "is-highlight",
          )}
          onClick={() => commitItem(item)}
        >
          <span className="min-w-0 flex-1 text-left">
            <span className="project-selector-label block">{itemLabel(item)}</span>
            {withBreadcrumb ? (
              <span className="project-selector-label block text-xs crm-text-muted">
                {groupLabel(group)} · {itemLabel(item)}
              </span>
            ) : null}
          </span>
          {selected ? <span className="project-selector-check">✓</span> : null}
        </button>
      </li>
    );
  };

  const panel = (
    <div
      className="project-selector-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDownList}
    >
      <header className="project-selector-header">
        {!desktop && step === "items" ? (
          <button
            type="button"
            className="project-selector-back"
            onClick={goBackToGroups}
            aria-label={backLabel}
          >
            ←
          </button>
        ) : (
          <span className="project-selector-back-spacer" />
        )}
        <h2 id={titleId} className="project-selector-title">
          {headerTitle}
        </h2>
        <button
          type="button"
          className="project-selector-close"
          onClick={closeSelector}
          aria-label={closeLabel}
        >
          ×
        </button>
      </header>

      <div className="project-selector-search">
        <input
          ref={searchRef}
          type="search"
          className="surface-input w-full px-3.5 py-2.5 text-sm crm-text placeholder:crm-text-muted"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
        />
      </div>

      {desktop ? (
        <div className="project-selector-dual">
          <ul
            className="project-selector-col project-selector-groups"
            role="listbox"
          >
            {REQUESTED_PROJECT_GROUPS.map((group) => {
              const selected = activeGroup === group.groupCode;
              return (
                <li key={group.groupCode}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cn(
                      "project-selector-row",
                      selected && "is-active",
                    )}
                    onClick={() => {
                      setActiveGroup(group.groupCode);
                      setQuery("");
                      setHighlight(0);
                    }}
                  >
                    <span className="project-selector-label truncate">
                      {groupLabel(group)}
                    </span>
                    <span className="project-selector-chevron" aria-hidden>
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="project-selector-col project-selector-items">
            {query.trim() ? (
              <ul role="listbox">
                {globalHits.map((hit, index) =>
                  renderItemButton(hit.item, index, !activeGroup),
                )}
              </ul>
            ) : activeGroup ? (
              <ul role="listbox">
                {level2Items.map((item, index) =>
                  renderItemButton(item, index, false),
                )}
              </ul>
            ) : (
              <p className="p-4 text-sm crm-text-muted">{selectCountryTitle}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="project-selector-mobile-body">
          {step === "groups" && !query.trim() ? (
            <ul
              key="groups"
              className="project-selector-mobile-pane"
              role="listbox"
            >
              {REQUESTED_PROJECT_GROUPS.map((group, index) => (
                <li key={group.groupCode}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedGroupCode === group.groupCode}
                    className={cn(
                      "project-selector-row",
                      highlight === index && "is-highlight",
                      selectedGroupCode === group.groupCode && "is-active",
                    )}
                    onClick={() => enterGroup(group)}
                  >
                    <span className="project-selector-label truncate">
                      {groupLabel(group)}
                    </span>
                    <span className="project-selector-chevron" aria-hidden>
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {step === "groups" && query.trim() ? (
            <ul
              key="group-search"
              className="project-selector-mobile-pane"
              role="listbox"
            >
              {globalHits.map((hit, index) =>
                renderItemButton(hit.item, index, true),
              )}
            </ul>
          ) : null}

          {step === "items" ? (
            <ul
              key={`items-${activeGroup ?? "none"}`}
              className="project-selector-mobile-pane"
              role="listbox"
            >
              {level2Items.map((item, index) =>
                renderItemButton(item, index, Boolean(query.trim())),
              )}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <div className={cn("project-selector", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        className={cn(
          "surface-input flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm",
          disabled && "cursor-not-allowed opacity-90",
        )}
        onClick={openSelector}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            triggerLabel ? "crm-text" : "crm-text-muted",
          )}
        >
          {triggerLabel || placeholder}
        </span>
        <span className="project-selector-chevron shrink-0" aria-hidden>
          ›
        </span>
      </button>

      {open
        ? createPortal(
            <div className="project-selector-root" role="presentation">
              <button
                type="button"
                className="project-selector-overlay"
                aria-label={closeLabel}
                onClick={closeSelector}
              />
              {panel}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
