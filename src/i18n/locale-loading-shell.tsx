import { LoadingSpinner } from "@/components/ui/loading";

export function LocaleLoadingShell() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 overflow-x-hidden px-6 text-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="text-lg font-semibold tracking-wide crm-text">ECHFRONT CRM</p>
      <LoadingSpinner size="lg" />
    </div>
  );
}
