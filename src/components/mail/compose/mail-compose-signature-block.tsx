"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { fetchCurrentSignature } from "@/lib/mail/client/api";
import { buildSignaturePreviewHtml } from "@/lib/mail/client/signature-management";
import {
  MailAdminErrorState,
  MailAdminLoadingState,
} from "@/components/mail/admin/mail-admin-states";

export function MailComposeSignatureBlock({
  senderIdentityId,
  compact = false,
  embeddedExpanded = false,
}: {
  senderIdentityId: string | null;
  compact?: boolean;
  embeddedExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!senderIdentityId) {
      setHtml(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchCurrentSignature(senderIdentityId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setHtml(null);
        return;
      }
      setHtml(
        result.item
          ? buildSignaturePreviewHtml({
              bodyText: result.item.bodyText,
              bodyHtml: result.item.bodyHtmlSanitized ?? "",
            })
          : null,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [senderIdentityId]);

  if (!senderIdentityId) return null;

  if ((compact || embeddedExpanded) && !loading && !error && !html) {
    return null;
  }

  const showTopDivider = compact && !embeddedExpanded && !loading && Boolean(html);

  return (
    <div
      className={cn(
        embeddedExpanded
          ? "px-3 pb-2 pt-1"
          : showTopDivider
            ? "border-t crm-border/70 px-3 py-2"
            : compact
              ? "px-3 py-2"
              : "border-t crm-border px-3 py-3",
      )}
    >
      {!compact && !embeddedExpanded ? (
        <p className="mb-2 text-xs font-medium uppercase tracking-wide crm-text-secondary">
          {t("mail.signature.locked")}
        </p>
      ) : null}
      {loading ? <MailAdminLoadingState compact /> : null}
      {error ? <MailAdminErrorState message={error} className="text-left" /> : null}
      {!loading && !error && html ? (
        <div
          className="prose prose-sm max-w-none crm-text-secondary dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
      {!compact && !embeddedExpanded && !loading && !error && !html ? (
        <p className="text-sm crm-text-secondary">{t("mail.compose.noSignature")}</p>
      ) : null}
    </div>
  );
}
