import { LoadingSpinner } from "@/components/ui/loading";

export default function KnowledgeRouteLoading() {
  return (
    <div
      className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8"
      aria-busy="true"
      data-knowledge-route-loading="true"
    >
      <div className="page-header space-y-3">
        <div className="knowledge-route-skeleton knowledge-route-skeleton--title" />
        <div className="knowledge-route-skeleton knowledge-route-skeleton--desc" />
      </div>
      <div
        className="surface-card knowledge-route-loading-card"
        aria-label="Loading knowledge"
      >
        <LoadingSpinner size="lg" />
      </div>
    </div>
  );
}
