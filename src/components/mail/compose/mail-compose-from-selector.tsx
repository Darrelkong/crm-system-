"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import type { ComposeContextOption } from "@/lib/mail/client/draft-management";

export function MailComposeFromSelector({
  options,
  senderIdentityId,
  mailboxId,
  onChange,
  disabled = false,
  loading = false,
  appearance = "form",
}: {
  options: ComposeContextOption[];
  senderIdentityId: string | null;
  mailboxId: string | null;
  onChange: (option: ComposeContextOption) => void;
  disabled?: boolean;
  loading?: boolean;
  appearance?: "form" | "email";
}) {
  const { t } = useTranslation();
  const selectedKey =
    senderIdentityId && mailboxId ? `${senderIdentityId}:${mailboxId}` : "";
  const isEmailAppearance = appearance === "email";

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 px-3",
        isEmailAppearance ? "border-b crm-border py-1.5" : "border-b crm-border py-2",
      )}
    >
      <span className="w-12 shrink-0 text-sm crm-text-secondary">
        {t("mail.compose.from")}
      </span>
      {loading ? (
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 text-sm crm-text-secondary",
            isEmailAppearance
              ? "min-h-8 border-b crm-border py-0.5"
              : "min-h-9 rounded-lg border crm-border px-2",
          )}
          aria-busy="true"
          aria-label={t("mail.compose.loadingFrom")}
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span className="truncate">{t("mail.compose.loadingFrom")}</span>
        </div>
      ) : (
        <select
          value={selectedKey}
          disabled={disabled || options.length === 0}
          onChange={(event) => {
            const option = options.find(
              (item) =>
                `${item.senderIdentityId}:${item.mailboxId}` === event.target.value,
            );
            if (option) onChange(option);
          }}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-sm crm-text outline-none",
            isEmailAppearance
              ? "min-h-8 border-b crm-border py-0.5"
              : "min-h-9 rounded-lg border crm-border px-2",
            disabled && "opacity-60",
          )}
          aria-label={t("mail.compose.from")}
        >
          {options.length === 0 ? (
            <option value="">{t("mail.compose.noFromAvailable")}</option>
          ) : (
            options.map((option) => (
              <option
                key={`${option.senderIdentityId}:${option.mailboxId}`}
                value={`${option.senderIdentityId}:${option.mailboxId}`}
              >
                {formatFromLabel(option)}
              </option>
            ))
          )}
        </select>
      )}
    </div>
  );
}

function formatFromLabel(option: ComposeContextOption): string {
  const name = option.displayName?.trim();
  const address = option.address;
  if (name) {
    return `${name} <${address}>`;
  }
  if (option.mailboxType === "shared" && option.mailboxDisplayName) {
    return `${address} · ${option.mailboxDisplayName}`;
  }
  return address;
}
