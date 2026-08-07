"use client";

export function LocaleErrorShell() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 overflow-x-hidden px-6 text-center">
      <p className="text-lg font-semibold tracking-wide crm-text">ECHFRONT CRM</p>
      <div className="max-w-sm space-y-2 text-sm crm-text-secondary">
        <p>Unable to load interface language. Please refresh the page.</p>
        <p>介面語言載入失敗，請重新整理頁面。</p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md border border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-2 text-sm font-medium crm-text transition-colors hover:bg-[var(--crm-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-focus-ring)]"
      >
        Refresh
      </button>
    </div>
  );
}
