"use client";

import type { MailInlineContext } from "@/lib/mail/cid-image";
import { Fragment, useMemo, type ReactNode } from "react";
import {
  isSafePlainTextUrl,
  resolveMailMessageBody,
} from "@/lib/mail/client/mail-message-body";

import { useTranslation } from "@/i18n/provider";
import { MailIsolatedHtmlDocument } from "./mail-isolated-html-document";

const PLAIN_TEXT_URL_PATTERN = /(https?:\/\/[^\s<>"']+)/gi;

function splitTrailingUrlPunctuation(value: string): {
  url: string;
  suffix: string;
} {
  let url = value;
  let suffix = "";
  while (/[.,!?;:)\]}>"']$/.test(url)) {
    suffix = url.slice(-1) + suffix;
    url = url.slice(0, -1);
  }
  return { url, suffix };
}

function renderPlainLine(line: string, lineKey: string): ReactNode {
  return line.split(PLAIN_TEXT_URL_PATTERN).map((part, index) => {
    const { url, suffix } = splitTrailingUrlPunctuation(part);
    if (!isSafePlainTextUrl(url)) {
      return <Fragment key={`${lineKey}-${index}`}>{part}</Fragment>;
    }
    return (
      <Fragment key={`${lineKey}-${index}`}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mail-message-body__link"
        >
          {url}
        </a>
        {suffix}
      </Fragment>
    );
  });
}

function renderPlainText(text: string): ReactNode {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph, paragraphIndex) => (
      <p
        key={`paragraph-${paragraphIndex}`}
        className="mail-message-body__plain-paragraph"
      >
        {paragraph.split("\n").map((line, lineIndex) => (
          <Fragment key={`line-${paragraphIndex}-${lineIndex}`}>
            {lineIndex > 0 ? <br /> : null}
            {renderPlainLine(line, `${paragraphIndex}-${lineIndex}`)}
          </Fragment>
        ))}
      </p>
    ));
}

export type MailMessageBodyRendererProps = {
  bodyHtml: string | null | undefined;
  bodyText: string | null | undefined;
  inlineContext?: MailInlineContext;
  className?: string;
  emptyLabel?: ReactNode;
};

/**
 * Shared renderer for server-normalized Mail body content.
 * HTML is never accepted from an unsanitized client-controlled field.
 */
export function MailMessageBodyRenderer({
  bodyHtml,
  bodyText,
  className,
  emptyLabel,
  inlineContext,
}: MailMessageBodyRendererProps) {
  const { t } = useTranslation();
  const imageLabels = useMemo(() => ({ unavailable: t("mail.detail.inlineImageUnavailable"), blocked: t("mail.detail.imageBlocked"), tiny: t("mail.detail.tinyImageBlocked"), load: t("mail.detail.loadImages"), privacy: t("mail.detail.imagePrivacy"), loaded: t("mail.detail.imagesLoaded") }), [t]);
  const resolved = resolveMailMessageBody({ bodyHtml, bodyText });
  const rootClassName = [
    "mail-message-body",
    `mail-message-body--${resolved.mode}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (resolved.mode === "html") {
    return <div className={rootClassName}><MailIsolatedHtmlDocument key={resolved.content} html={resolved.content} labels={imageLabels} inlineContext={inlineContext} /></div>;
  }

  if (resolved.mode === "plain_text") {
    return <div className={rootClassName}>{renderPlainText(resolved.content)}</div>;
  }

  return emptyLabel ? (
    <div className={rootClassName} role="status">
      {emptyLabel}
    </div>
  ) : null;
}
