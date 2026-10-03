"use client";

import { useEffect, useMemo, useState } from "react";
import { MailMessageBodyRenderer } from "@/components/mail/mail-message-body-renderer";
import { inertMailCids, type MailInlineContext } from "@/lib/mail/cid-image";
import { inertMailImages } from "@/lib/mail/inert-image";
import { fetchMessageDetail } from "@/lib/mail/client/mail-read-api-client";
import { useTranslation } from "@/i18n/provider";

/** A quote is never contentEditable. Resource authorization is independent of
 * draft ownership and the resource map is never part of the autosave payload.
 */
export function MailComposeQuote({ html, sourceMessageId }: {
  html: string;
  sourceMessageId?: string | null;
}) {
  const { t } = useTranslation();
  const hasCid = useMemo(() => inertMailCids(html).length > 0, [html]);
  const hasImages = hasCid || inertMailImages(html).length > 0;
  const [context, setContext] = useState<MailInlineContext>();
  useEffect(() => {
    if (!hasCid || !sourceMessageId) return;
    let current = true;
    // This existing authenticated API rechecks live Mail/message/mailbox access.
    // Trashed/inaccessible sources fail closed; no cross-folder fallback.
    void fetchMessageDetail({ messageId: sourceMessageId }).then(detail => {
      if (current && detail.id === sourceMessageId) {
        setContext({ messageId: detail.id, resources: detail.inlineResources ?? [] });
      }
    }).catch(() => { if (current) setContext(undefined); });
    return () => { current = false; };
  }, [hasCid, sourceMessageId]);

  return <div className="mail-compose-quoted mt-2 min-w-0 rounded-md border crm-border p-3">
    {hasImages && <p className="mb-2 text-xs crm-text-secondary">{t("mail.compose.quoteImagesNotice")}</p>}
    <MailMessageBodyRenderer bodyHtml={html} bodyText={null}
      inlineContext={context?.messageId === sourceMessageId ? context : undefined} />
  </div>;
}
