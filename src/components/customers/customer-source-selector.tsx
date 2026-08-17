"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { CustomerSourceMenuOption } from "@/lib/customer-sources/keys";
import { resolveSourceMenuDisplayPath } from "@/lib/customer-sources/menu";

export type CustomerSourceSelectorProps = {
  value: string;
  onChange: (tagKey: string) => void;
  options: CustomerSourceMenuOption[];
  /** Shown when value is legacy/inactive and not in options */
  legacyLabel?: string | null;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
};

function findSelectedLabel(
  value: string,
  options: CustomerSourceMenuOption[],
  legacyLabel?: string | null,
): string {
  if (!value) return "";
  for (const option of options) {
    if (option.kind === "direct" || option.kind === "custom") {
      if (option.tagKey === value) return option.label;
    } else if (option.kind === "group") {
      const child = option.children.find((c) => c.tagKey === value);
      if (child) {
        return (
          resolveSourceMenuDisplayPath(child.tagKey, child.label)?.displayLabel ??
          child.label
        );
      }
    }
  }
  const path = resolveSourceMenuDisplayPath(value, legacyLabel ?? undefined);
  return path?.displayLabel ?? legacyLabel ?? value;
}

export function CustomerSourceSelector({
  value,
  onChange,
  options,
  legacyLabel,
  disabled,
  id,
  "aria-label": ariaLabel,
}: CustomerSourceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<CustomerSourceMenuOption | null>(
    null,
  );

  const selectedLabel = useMemo(
    () => findSelectedLabel(value, options, legacyLabel),
    [value, options, legacyLabel],
  );

  function handlePick(tagKey: string) {
    onChange(tagKey);
    setOpen(false);
    setActiveGroup(null);
  }

  function renderTopLevel() {
    return (
      <ul className="source-selector-list" role="listbox">
        {options.map((option) => {
          if (option.kind === "direct" || option.kind === "custom") {
            const selected = value === option.tagKey;
            return (
              <li key={option.tagKey}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "source-selector-row",
                    selected && "is-selected",
                  )}
                  onClick={() => handlePick(option.tagKey)}
                >
                  <span className="source-selector-label">{option.label}</span>
                  {selected ? (
                    <span className="source-selector-check" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          }

          return (
            <li key={option.groupKey}>
              <button
                type="button"
                className="source-selector-row"
                onClick={() => setActiveGroup(option)}
              >
                <span className="source-selector-label">{option.label}</span>
                <span className="source-selector-chevron" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  function renderGroupChildren(
    group: Extract<CustomerSourceMenuOption, { kind: "group" }>,
  ) {
    return (
      <div>
        <div className="source-selector-subheader">
          <button
            type="button"
            className="source-selector-back"
            onClick={() => setActiveGroup(null)}
          >
            ← 返回
          </button>
          <span className="source-selector-subtitle">{group.label}</span>
        </div>
        <ul className="source-selector-list" role="listbox">
          {group.children.map((child) => {
            const selected = value === child.tagKey;
            const display =
              resolveSourceMenuDisplayPath(child.tagKey, child.label)
                ?.displayLabel ?? child.label;
            return (
              <li key={child.tagKey}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "source-selector-row",
                    selected && "is-selected",
                  )}
                  onClick={() => handlePick(child.tagKey)}
                >
                  <span className="source-selector-label">{display}</span>
                  {selected ? (
                    <span className="source-selector-check" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="source-selector relative">
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className={cn(
          "surface-input flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm",
          disabled && "cursor-not-allowed opacity-60",
        )}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
          setActiveGroup(null);
        }}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            selectedLabel ? "crm-text" : "crm-text-muted",
          )}
        >
          {selectedLabel || "请选择客户来源"}
        </span>
        <span className="source-selector-chevron shrink-0" aria-hidden>
          ▾
        </span>
      </button>

      {open && !disabled ? (
        <div className="source-selector-menu">
          {activeGroup?.kind === "group"
            ? renderGroupChildren(activeGroup)
            : renderTopLevel()}
          <div className="source-selector-footer">
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              onClick={() => {
                setOpen(false);
                setActiveGroup(null);
              }}
            >
              关闭
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
