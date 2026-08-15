import { cn } from "@/lib/cn";

export function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-slate-100 dark:bg-slate-800",
        className,
      )}
      aria-hidden="true"
    />
  );
}

export function SkeletonCard({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("surface-card p-4 sm:p-6", className)}>{children}</div>
  );
}

export function PageIntroSkeleton() {
  return (
    <div className="mb-6 space-y-2">
      <SkeletonBar className="h-7 w-48 max-w-full sm:h-8 sm:w-56" />
      <SkeletonBar className="h-4 w-full max-w-xl" />
    </div>
  );
}

export function ListRowSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="list-row w-full p-4">
      <SkeletonBar className="h-5 w-40 max-w-[70%]" />
      {lines > 1 && <SkeletonBar className="mt-2 h-4 w-3/4 max-w-md" />}
      {lines > 2 && <SkeletonBar className="mt-2 h-4 w-1/2 max-w-xs" />}
    </div>
  );
}
