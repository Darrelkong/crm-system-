"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
      <ul className="max-h-72 space-y-1 overflow-y-auto" role="listbox">
        {options.map((option) => {
          if (option.kind === "direct" || option.kind === "custom") {
            return (
              <li key={option.tagKey}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === option.tagKey}
                  className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[#EEF3F8]"
                  onClick={() => handlePick(option.tagKey)}
                >
                  {option.label}
                </button>
              </li>
            );
          }

          return (
            <li key={option.groupKey}>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-[#EEF3F8]"
                onClick={() => setActiveGroup(option)}
              >
                <span>{option.label}</span>
                <span className="text-[#6B7890]" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  function renderGroupChildren(group: Extract<CustomerSourceMenuOption, { kind: "group" }>) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-2 border-b border-[#E6EBF2] pb-2">
          <button
            type="button"
            className="text-sm text-[#2F6FB3] hover:underline"
            onClick={() => setActiveGroup(null)}
          >
            ← 返回
          </button>
          <span className="text-sm font-medium text-[#172033]">{group.label}</span>
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto" role="listbox">
          {group.children.map((child) => (
            <li key={child.tagKey}>
              <button
                type="button"
                role="option"
                aria-selected={value === child.tagKey}
                className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[#EEF3F8]"
                onClick={() => handlePick(child.tagKey)}
              >
                {child.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className="flex w-full items-center justify-between rounded-md border border-[#D5DEEA] bg-white px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
          setActiveGroup(null);
        }}
      >
        <span className={selectedLabel ? "text-[#172033]" : "text-[#6B7890]"}>
          {selectedLabel || "请选择客户来源"}
        </span>
        <span className="text-[#6B7890]" aria-hidden>
          ▾
        </span>
      </button>

      {open && !disabled ? (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-[#D5DEEA] bg-white p-2 shadow-lg">
          {activeGroup?.kind === "group"
            ? renderGroupChildren(activeGroup)
            : renderTopLevel()}
          <div className="mt-2 flex justify-end">
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
