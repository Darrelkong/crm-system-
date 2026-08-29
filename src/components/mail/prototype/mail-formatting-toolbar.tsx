"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  RemoveFormatting,
  Underline,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { MailComposeColorPalette } from "@/components/mail/compose/mail-compose-color-palette";

const FONTS = [
  "Default",
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Verdana",
] as const;

const SIZES = ["12", "14", "16", "18", "20", "24"] as const;

export function MailFormattingToolbar({
  editorRef,
  className,
  compact = false,
  dock = false,
}: {
  editorRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
  compact?: boolean;
  dock?: boolean;
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

  function clearFormatting() {
    exec("removeFormat");
    exec("foreColor", "#000000");
  }

  return (
    <div
      className={cn(
        "mail-formatting-toolbar flex flex-wrap items-center gap-0.5 px-1.5 py-1",
        dock
          ? "border-0 bg-transparent"
          : "border-b crm-border bg-[var(--color-crm-bg-muted)]/40",
        compact && "mail-formatting-toolbar--compact",
        className,
      )}
    >
      <select
        className="h-8 max-w-[92px] rounded-md border-0 bg-transparent px-1 text-xs crm-text"
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
        className="h-8 w-12 rounded-md border-0 bg-transparent px-1 text-xs crm-text"
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
      <ToolbarDivider />
      <ToolbarBtn onClick={() => exec("bold")} label={t("mail.compose.bold")}>
        <Bold className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => exec("italic")} label={t("mail.compose.italic")}>
        <Italic className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => exec("underline")}
        label={t("mail.compose.underline")}
      >
        <Underline className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <MailComposeColorPalette onSelectColor={(color) => exec("foreColor", color)} />
      <ToolbarDivider />
      <ToolbarBtn
        onClick={() => exec("justifyLeft")}
        label={t("mail.compose.alignLeft")}
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => exec("justifyCenter")}
        label={t("mail.compose.alignCenter")}
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => exec("justifyRight")}
        label={t("mail.compose.alignRight")}
      >
        <AlignRight className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => exec("insertUnorderedList")}
        label={t("mail.compose.bulletList")}
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => exec("insertOrderedList")}
        label={t("mail.compose.orderedList")}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => exec("outdent")}
        label={t("mail.compose.indentDecrease")}
      >
        <IndentDecrease className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => exec("indent")}
        label={t("mail.compose.indentIncrease")}
      >
        <IndentIncrease className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarDivider />
      <ToolbarBtn
        onClick={() => {
          const url = window.prompt("URL");
          if (url) exec("createLink", url);
        }}
        label={t("mail.compose.link")}
      >
        <Link className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={clearFormatting}
        label={t("mail.compose.clearFormatting")}
      >
        <RemoveFormatting className="h-3.5 w-3.5" />
      </ToolbarBtn>
    </div>
  );
}

function ToolbarDivider() {
  return (
    <span
      className="mx-0.5 hidden h-5 w-px shrink-0 bg-[var(--color-crm-border)] sm:inline-block"
      aria-hidden
    />
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
      className="mail-compose-toolbar-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
    >
      {children}
    </button>
  );
}
