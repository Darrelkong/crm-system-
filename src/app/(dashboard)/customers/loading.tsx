export default function CustomersLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Toolbar placeholder */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-9 w-56 rounded-xl bg-[var(--color-crm-bg-muted)]" />
        <div className="h-9 w-32 rounded-xl bg-[var(--color-crm-bg-muted)]" />
        <div className="ml-auto h-9 w-28 rounded-xl bg-[var(--color-crm-bg-muted)]" />
      </div>

      {/* List rows */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonListRow key={i} />
        ))}
      </div>
    </div>
  );
}

function SkeletonListRow() {
  return (
    <div className="list-row flex items-center gap-4 px-4 py-3.5">
      <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--color-crm-bg-muted)]" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-4 w-40 rounded bg-[var(--color-crm-bg-muted)]" />
        <div className="h-3 w-56 rounded bg-[var(--color-crm-bg-muted)]" />
      </div>
      <div className="hidden shrink-0 space-y-1.5 sm:block">
        <div className="h-3.5 w-20 rounded bg-[var(--color-crm-bg-muted)]" />
        <div className="h-3 w-16 rounded bg-[var(--color-crm-bg-muted)]" />
      </div>
      <div className="h-6 w-16 shrink-0 rounded-full bg-[var(--color-crm-bg-muted)]" />
    </div>
  );
}
