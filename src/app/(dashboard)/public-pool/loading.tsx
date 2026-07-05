export default function PublicPoolLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Header / claim status bar placeholder */}
      <div className="surface-card flex flex-wrap items-center gap-4 px-4 py-3">
        <div className="h-4 w-36 rounded bg-[var(--color-crm-bg-muted)]" />
        <div className="ml-auto h-8 w-28 rounded-xl bg-[var(--color-crm-bg-muted)]" />
      </div>

      {/* List rows */}
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonPoolRow key={i} />
        ))}
      </div>
    </div>
  );
}

function SkeletonPoolRow() {
  return (
    <div className="list-row flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-4 w-36 rounded bg-[var(--color-crm-bg-muted)]" />
        <div className="h-3 w-48 rounded bg-[var(--color-crm-bg-muted)]" />
      </div>
      <div className="hidden shrink-0 space-y-1 sm:block">
        <div className="h-3 w-24 rounded bg-[var(--color-crm-bg-muted)]" />
      </div>
      <div className="h-8 w-16 shrink-0 rounded-xl bg-[var(--color-crm-bg-muted)]" />
    </div>
  );
}
