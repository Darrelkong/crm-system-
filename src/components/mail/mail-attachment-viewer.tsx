"use client";

import { Download, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { formatAttachmentSize } from "@/lib/mail/client/draft-management";

type MailAttachmentViewerProps = {
  filename: string;
  sizeBytes: number;
  previewType: "image" | "pdf";
  previewHref: string;
  downloadHref: string | null;
  onClose: () => void;
};

export function MailAttachmentViewer({
  filename,
  sizeBytes,
  previewType,
  previewHref,
  downloadHref,
  onClose,
}: MailAttachmentViewerProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [onClose]);

  const handlePreviewError = () => {
    setLoading(false);
    setPreviewError(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mail-attachment-viewer-title"
        tabIndex={-1}
        className="flex h-[calc(100dvh-1rem)] w-full min-w-0 flex-col overflow-hidden rounded-lg bg-white shadow-2xl outline-none dark:bg-slate-950 sm:h-[min(90dvh,56rem)] sm:max-w-6xl"
      >
        <header className="flex shrink-0 min-w-0 items-center gap-2 border-b border-black/10 px-3 py-3 dark:border-white/10 sm:px-4">
          <div className="min-w-0 flex-1">
            <h2
              id="mail-attachment-viewer-title"
              className="break-all text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              {filename}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {formatAttachmentSize(sizeBytes)}
            </p>
          </div>
          {downloadHref ? (
            <a
              href={downloadHref}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-slate-700 hover:bg-black/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.08]"
              download
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>{t("common.download")}</span>
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-slate-700 hover:bg-black/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.08]"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:p-6">
          {loading && !previewError ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              <LoaderCircle className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
              {t("common.loading")}
            </div>
          ) : null}

          {previewError ? (
            <div className="flex max-w-sm flex-col items-center gap-3 text-center text-sm text-slate-600 dark:text-slate-300">
              <p>{t("mail.attachment.unavailable")}</p>
              {downloadHref ? (
                <a
                  href={downloadHref}
                  className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                  download
                >
                  {t("mail.attachment.downloadFile")}
                </a>
              ) : null}
            </div>
          ) : previewType === "image" ? (
            <img
              src={previewHref}
              alt={filename}
              className="max-h-full max-w-full object-contain"
              onLoad={() => setLoading(false)}
              onError={handlePreviewError}
            />
          ) : (
            <object
              data={previewHref}
              type="application/pdf"
              aria-label={filename}
              className="h-full min-h-0 w-full"
              onLoad={() => setLoading(false)}
              onError={handlePreviewError}
            >
              <div className="flex h-full items-center justify-center text-center text-sm text-slate-600 dark:text-slate-300">
                {t("mail.attachment.pdfPreviewUnavailable")}
              </div>
            </object>
          )}
        </div>
      </div>
    </div>
  );
}
