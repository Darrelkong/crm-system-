"use client";

import { useState } from "react";
import { isZipAttachmentFilename } from "@/lib/mail/compose-attachment-policy";

type PendingFile = {
  name: string;
  sizeBytes: number;
};

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function MailLargeAttachmentAcknowledgementModal({
  files,
  onCancel,
  onConfirm,
}: {
  files: PendingFile[] | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [checked, setChecked] = useState(false);

  if (!files) return null;

  const includesZip = files.some((file) => isZipAttachmentFilename(file.name));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="flex max-h-[min(90dvh,680px)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border crm-border bg-[var(--color-crm-bg)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="large-attachment-acknowledgement-title"
      >
        <div className="min-h-0 overflow-y-auto px-5 pb-4 pt-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2
              id="large-attachment-acknowledgement-title"
              className="text-lg font-semibold leading-tight crm-text"
            >
              大附件上传声明
            </h2>
            <span className="status-badge text-xs crm-text-secondary">
              未启用自动安全扫描
            </span>
          </div>
          <div className="mt-4 space-y-3 text-sm leading-7 crm-text">
            <p>
              当前系统暂未对大附件进行自动安全扫描。请您在上传前自行确认文件内容合法、合规、安全，并确保您拥有上传、使用及发送该文件所需的相关授权。
            </p>
            <p>
              请勿上传含有病毒、木马、恶意程序、违法违规内容、侵权内容或其他可能危害系统、用户或第三方的文件。
            </p>
            <p>
              上传人应对其上传文件的合法性、安全性及相关授权情况负责，并依法承担因其上传行为所产生的相应责任。
            </p>
            <p>请确认文件无误后再继续上传。</p>
          </div>

          <div className="mt-4 rounded-lg border crm-border bg-[var(--color-crm-bg-muted)]/50 px-3 py-2">
            <p className="text-xs font-medium crm-text">本次上传文件</p>
            <ul className="mt-1 space-y-1 text-xs crm-text-secondary">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0">{formatFileSize(file.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          </div>

          {includesZip ? (
            <div className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-medium">压缩文件提示</p>
              <p className="mt-1">
                系统无法自动检查压缩包内部文件，请确认压缩包及其中全部文件安全、合规后再上传。
              </p>
            </div>
          ) : null}

          <label className="mt-4 flex min-h-11 cursor-pointer select-none items-start gap-3 rounded-lg px-2 py-2 text-sm leading-6 crm-text transition-colors hover:bg-[var(--color-crm-bg-muted)]/60">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-crm-accent)]"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>
              我已阅读并理解上述声明，并确认所上传文件已自行检查且符合相关要求。
            </span>
          </label>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-3 border-t crm-border bg-[var(--color-crm-bg)] px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            className="secondary-button min-h-11 w-full px-4 py-2 text-sm font-medium sm:w-auto"
            onClick={() => {
              setChecked(false);
              onCancel();
            }}
          >
            取消
          </button>
          <button
            type="button"
            className={
              checked
                ? "primary-button min-h-11 w-full px-4 py-2 text-sm font-semibold text-white transition-all active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-crm-primary)] sm:w-auto"
                : "min-h-11 w-full cursor-not-allowed border crm-border bg-[var(--color-crm-bg-muted)] px-4 py-2 text-sm font-semibold crm-text-secondary shadow-none disabled:cursor-not-allowed sm:w-auto"
            }
            disabled={!checked}
            onClick={() => {
              setChecked(false);
              onConfirm();
            }}
          >
            继续上传
          </button>
        </div>
      </div>
    </div>
  );
}
