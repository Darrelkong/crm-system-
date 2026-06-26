import { cn } from "@/lib/cn";
import { PageIntro } from "@/components/ui/page-intro";

export function Card({
  className,
  children,
  padding = true,
  interactive = false,
}: {
  className?: string;
  children: React.ReactNode;
  padding?: boolean;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        interactive ? "interactive-card" : "surface-card",
        padding && "p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return <PageIntro title={title} description={description} action={action} />;
}

export function EmptyState({
  message,
  action,
  icon,
}: {
  message: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="surface-card flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E8F1FA] text-[#2F6FB3]">
        {icon ?? (
          <svg
            className="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        )}
      </div>
      <p className="text-sm text-[#6B7890]">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Badge({
  className,
  children,
  variant = "default",
}: {
  className?: string;
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "accent";
}) {
  const variants = {
    default: "bg-[#EEF3F8] text-[#172033] ring-[#E3E8F0]",
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
    danger: "bg-red-50 text-red-800 ring-red-200",
    accent: "bg-[#E8F1FA] text-[#1F4E79] ring-[#C5DAF0]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
