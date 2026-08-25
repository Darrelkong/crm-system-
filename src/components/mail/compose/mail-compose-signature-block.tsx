"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { fetchCurrentSignature } from "@/lib/mail/client/api";
import { buildSignaturePreviewHtml } from "@/lib/mail/client/signature-management";
import {
  MailAdminErrorState,
  MailAdminLoadingState,
} from "@/components/mail/admin/mail-admin-states";

export function MailComposeSignatureBlock({
  senderIdentityId,
}: {
  senderIdentityId: string | null;
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

  return (
    <div className="border-t crm-border px-3 py-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide crm-text-secondary">
        {t("mail.signature.locked")}
      </p>
      {loading ? <MailAdminLoadingState compact /> : null}
      {error ? <MailAdminErrorState message={error} className="text-left" /> : null}
      {!loading && !error && html ? (
        <div
          className="prose prose-sm max-w-none crm-text dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
      {!loading && !error && !html ? (
        <p className="text-sm crm-text-secondary">{t("mail.compose.noSignature")}</p>
      ) : null}
    </div>
  );
}
