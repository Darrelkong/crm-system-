"use client";

import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import type { ComposeContextOption } from "@/lib/mail/client/draft-management";

export function MailComposeFromSelector({
  options,
  senderIdentityId,
  mailboxId,
  onChange,
  disabled = false,
}: {
  options: ComposeContextOption[];
  senderIdentityId: string | null;
  mailboxId: string | null;
  onChange: (option: ComposeContextOption) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const selectedKey =
    senderIdentityId && mailboxId ? `${senderIdentityId}:${mailboxId}` : "";

  return (
    <div className="flex min-w-0 items-center gap-2 border-b crm-border px-3 py-2">
      <span className="w-12 shrink-0 text-sm crm-text-secondary">
        {t("mail.compose.from")}
      </span>
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
          "min-h-9 min-w-0 flex-1 rounded-lg border crm-border bg-transparent px-2 text-sm crm-text",
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
