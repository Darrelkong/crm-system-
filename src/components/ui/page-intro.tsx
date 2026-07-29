import { cn } from "@/lib/cn";

export function PageIntro({
  title,
  description,
  action,
  className,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Reduced vertical spacing for dense pages such as Reports. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "page-header flex flex-col sm:flex-row sm:items-start sm:justify-between",
        compact ? "gap-2" : "gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className={cn("page-title", compact && "text-xl sm:text-2xl")}>
          {title}
        </h2>
        {description && (
          <p
            className={cn(
              "page-description",
              compact && "mt-1 text-sm leading-snug",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}
