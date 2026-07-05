export default function StaffLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Page header placeholder */}
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-lg bg-[var(--color-crm-bg-muted)]" />
        <div className="h-4 w-64 rounded-md bg-[var(--color-crm-bg-muted)]" />
      </div>

      {/* First KPI row – 4 cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonKpiCard key={i} />
        ))}
      </div>

      {/* Second KPI row – 3 cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonKpiCard key={i} />
        ))}
      </div>

      {/* Recent cards row – 2 panels */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonPanel rows={3} />
        <SkeletonPanel rows={3} />
      </div>
    </div>
  );
}

function SkeletonKpiCard() {
  return (
    <div className="interactive-card relative overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-24 rounded bg-[var(--color-crm-bg-muted)]" />
          <div className="h-8 w-16 rounded-md bg-[var(--color-crm-bg-muted)]" />
          <div className="h-3 w-32 rounded bg-[var(--color-crm-bg-muted)]" />
        </div>
        <div className="h-10 w-10 shrink-0 rounded-xl bg-[var(--color-crm-bg-muted)]" />
      </div>
    </div>
  );
}

function SkeletonPanel({ rows }: { rows: number }) {
  return (
    <div className="surface-card p-5 space-y-3">
      <div className="h-5 w-36 rounded-md bg-[var(--color-crm-bg-muted)]" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--color-crm-bg-muted)]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-3/4 rounded bg-[var(--color-crm-bg-muted)]" />
              <div className="h-3 w-1/2 rounded bg-[var(--color-crm-bg-muted)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
