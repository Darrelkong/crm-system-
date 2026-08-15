import {
  ListRowSkeleton,
  PageIntroSkeleton,
  SkeletonBar,
  SkeletonCard,
} from "@/components/ui/skeleton";

function LoadingLabel({ label }: { label: string }) {
  return <span className="sr-only">{label}</span>;
}

/**
 * Generic admin-section skeleton for admin/loading.tsx.
 * Applies to /admin and nested /admin/* routes — intentionally not
 * dashboard-specific so Users/Settings do not flash KPI/chart placeholders.
 */
export function AdminSectionLoadingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <PageIntroSkeleton />
      <div className="flex flex-wrap gap-2">
        <SkeletonBar className="h-10 w-24 rounded-xl" />
        <SkeletonBar className="h-10 w-28 rounded-xl" />
        <SkeletonBar className="h-10 w-20 rounded-xl" />
      </div>
      <SkeletonCard>
        <SkeletonBar className="mb-4 h-5 w-36" />
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonBar key={i} className="h-11 w-full" />
          ))}
        </div>
      </SkeletonCard>
      <LoadingLabel label="Loading admin page" />
    </div>
  );
}

/** Staff dashboard skeleton — /staff has no nested routes. */
export function StaffDashboardLoadingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <SkeletonBar className="h-8 w-56 max-w-full sm:h-9" />
        <SkeletonBar className="h-4 w-72 max-w-full" />
      </div>
      <div>
        <SkeletonBar className="mb-4 h-5 w-44" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} className="min-h-[88px]">
              <SkeletonBar className="h-3 w-24" />
              <SkeletonBar className="mt-3 h-8 w-16" />
            </SkeletonCard>
          ))}
        </div>
      </div>
      <SkeletonCard>
        <SkeletonBar className="mb-4 h-5 w-40" />
        <SkeletonBar className="h-[220px] w-full rounded-xl" />
      </SkeletonCard>
      <SkeletonCard>
        <SkeletonBar className="mb-4 h-5 w-36" />
        <SkeletonBar className="h-24 w-full rounded-xl" />
      </SkeletonCard>
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard className="min-h-[180px]" />
        <SkeletonCard className="min-h-[180px]" />
      </div>
      <LoadingLabel label="Loading dashboard" />
    </div>
  );
}

export function CustomerListLoadingSkeleton() {
  return (
    <div aria-busy="true">
      <PageIntroSkeleton />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <SkeletonBar className="h-10 w-full md:w-40" />
        <SkeletonBar className="h-10 w-full md:w-36" />
        <SkeletonBar className="h-10 w-full md:w-44" />
        <SkeletonBar className="h-10 w-24" />
      </div>

      <div className="hidden md:block">
        <SkeletonCard className="overflow-hidden p-0">
          <div className="border-b crm-border px-4 py-3">
            <div className="flex gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <SkeletonBar key={i} className="h-4 w-16" />
              ))}
            </div>
          </div>
          <div className="divide-y crm-border">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <SkeletonBar className="h-4 w-32" />
                <SkeletonBar className="h-4 w-20" />
                <SkeletonBar className="h-4 w-24" />
                <SkeletonBar className="h-5 w-14 rounded-full" />
                <SkeletonBar className="ml-auto h-4 w-16" />
              </div>
            ))}
          </div>
        </SkeletonCard>
      </div>

      <div className="space-y-3 md:hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <SkeletonBar className="h-5 w-36" />
              <SkeletonBar className="h-5 w-12 rounded-full" />
            </div>
            <SkeletonBar className="mt-3 h-4 w-28" />
            <SkeletonBar className="mt-2 h-4 w-40" />
          </SkeletonCard>
        ))}
      </div>
      <LoadingLabel label="Loading customer list" />
    </div>
  );
}

export function WorkItemsLoadingSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <PageIntroSkeleton />
      <div className="flex flex-wrap gap-2">
        <SkeletonBar className="h-9 w-24 rounded-full" />
        <SkeletonBar className="h-9 w-28 rounded-full" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SkeletonBar className="h-9 w-20 rounded-full" />
        <SkeletonBar className="h-9 w-24 rounded-full" />
        <SkeletonBar className="h-9 w-24 rounded-full" />
        <SkeletonBar className="ml-auto h-4 w-28" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <ListRowSkeleton key={i} lines={3} />
        ))}
      </div>
      <LoadingLabel label="Loading work items" />
    </div>
  );
}

export function PublicPoolLoadingSkeleton() {
  return (
    <div aria-busy="true">
      <PageIntroSkeleton />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonCard key={i} className="min-h-[76px]">
            <SkeletonBar className="h-3 w-24" />
            <SkeletonBar className="mt-2 h-7 w-16" />
          </SkeletonCard>
        ))}
      </div>
      <SkeletonBar className="mb-4 h-4 w-full max-w-md" />
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <ListRowSkeleton key={i} lines={2} />
        ))}
      </div>
      <LoadingLabel label="Loading public pool" />
    </div>
  );
}

export function ApprovalsLoadingSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBar key={i} className="h-9 w-20 rounded-full" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <ListRowSkeleton key={i} lines={2} />
        ))}
      </div>
      <LoadingLabel label="Loading approvals" />
    </div>
  );
}

export function FollowUpsLoadingSkeleton() {
  return (
    <div aria-busy="true">
      <PageIntroSkeleton />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap">
        <SkeletonBar className="h-11 w-full md:w-[280px]" />
        <SkeletonBar className="h-11 w-full md:w-[160px]" />
        <SkeletonBar className="h-11 w-full md:w-[138px]" />
        <SkeletonBar className="h-11 w-full md:w-[138px]" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <ListRowSkeleton key={i} lines={3} />
        ))}
      </div>
      <LoadingLabel label="Loading follow-ups" />
    </div>
  );
}
