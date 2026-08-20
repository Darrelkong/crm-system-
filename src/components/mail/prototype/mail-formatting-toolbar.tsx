"use client";

import { Bold, Italic, Link, Underline } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";

const FONTS = [
  "Default",
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Verdana",
] as const;

const SIZES = ["12", "14", "16", "18", "20", "24"] as const;

const TEXT_COLORS = [
  "#000000",
  "#374151",
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#9333ea",
] as const;

export function MailFormattingToolbar({
  editorRef,
  className,
}: {
  editorRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  const { t } = useTranslation();

  function exec(cmd: string, value?: string) {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  }

  function applyFont(font: string) {
    if (font === "Default") {
      exec("removeFormat");
    } else {
      exec("fontName", font);
    }
  }

  function applySize(size: string) {
    exec(
      "fontSize",
      size === "12"
        ? "2"
        : size === "14"
          ? "3"
          : size === "16"
            ? "4"
            : size === "18"
              ? "5"
              : size === "20"
                ? "6"
                : "7",
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 border-b crm-border px-2 py-2",
        className,
      )}
    >
      <select
        className="min-h-9 max-w-[min(100px,28vw)] rounded-lg border crm-border bg-transparent px-2 text-xs crm-text"
        defaultValue="Default"
        onChange={(e) => applyFont(e.target.value)}
        aria-label={t("mail.compose.font")}
      >
        {FONTS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <select
        className="min-h-9 w-14 rounded-lg border crm-border bg-transparent px-2 text-xs crm-text"
        defaultValue="16"
        onChange={(e) => applySize(e.target.value)}
        aria-label={t("mail.compose.size")}
      >
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <ToolbarBtn onClick={() => exec("bold")} label="Bold">
        <Bold className="h-4 w-4" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => exec("italic")} label="Italic">
        <Italic className="h-4 w-4" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => exec("underline")} label="Underline">
        <Underline className="h-4 w-4" />
      </ToolbarBtn>
      <div className="flex max-w-full flex-wrap items-center gap-0.5">
        {TEXT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => exec("foreColor", color)}
            className="h-7 w-7 shrink-0 rounded-md border crm-border"
            style={{ backgroundColor: color }}
            aria-label={`Color ${color}`}
          />
        ))}
        <input
          type="color"
          className="h-7 w-8 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
          onChange={(e) => exec("foreColor", e.target.value)}
          aria-label={t("mail.compose.customColor")}
        />
      </div>
      <ToolbarBtn
        onClick={() => {
          const url = window.prompt("URL");
          if (url) exec("createLink", url);
        }}
        label="Link"
      >
        <Link className="h-4 w-4" />
      </ToolbarBtn>
    </div>
  );
}

function ToolbarBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg nav-item"
    >
      {children}
    </button>
  );
}
