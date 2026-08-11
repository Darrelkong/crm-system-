import { LoadingSpinner } from "@/components/ui/loading";

function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-100 ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}

export default function CustomerDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy="true">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <SkeletonBar className="h-8 w-48 max-w-full sm:h-9 sm:w-56" />
          <div className="flex flex-wrap gap-2">
            <SkeletonBar className="h-6 w-16" />
            <SkeletonBar className="h-6 w-20" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SkeletonBar className="h-10 w-24" />
          <SkeletonBar className="h-10 w-28" />
          <SkeletonBar className="h-10 w-20" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="space-y-4 lg:col-span-2 lg:space-y-6">
          <div className="surface-card p-4 sm:p-6">
            <SkeletonBar className="mb-4 h-5 w-32" />
            <div className="space-y-3">
              <SkeletonBar className="h-4 w-full" />
              <SkeletonBar className="h-4 w-5/6" />
              <SkeletonBar className="h-4 w-2/3" />
              <SkeletonBar className="h-4 w-4/5" />
            </div>
          </div>
          <div className="surface-card p-4 sm:p-6">
            <SkeletonBar className="mb-4 h-5 w-28" />
            <div className="space-y-3">
              <SkeletonBar className="h-4 w-full" />
              <SkeletonBar className="h-4 w-3/4" />
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:space-y-6">
          <div className="surface-card p-4 sm:p-6">
            <SkeletonBar className="mb-4 h-5 w-24" />
            <div className="space-y-3">
              <SkeletonBar className="h-4 w-full" />
              <SkeletonBar className="h-4 w-5/6" />
              <SkeletonBar className="h-4 w-4/5" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-center gap-2 py-2">
        <LoadingSpinner size="sm" />
        <span className="sr-only">Loading customer detail</span>
      </div>
    </div>
  );
}
