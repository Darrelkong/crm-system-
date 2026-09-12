import { cn } from "@/lib/cn";

export type KnowledgeIngestStepStatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "processing"
  | "danger";

export function KnowledgeIngestStepHeader({
  step,
  title,
  status,
  tone = "neutral",
}: {
  step?: number;
  title: string;
  status?: string;
  tone?: KnowledgeIngestStepStatusTone;
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : tone === "processing"
          ? "border-blue-200 bg-blue-50 text-blue-900"
          : tone === "danger"
            ? "border-rose-200 bg-rose-50 text-rose-900"
            : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div
      className="flex min-w-0 items-start justify-between gap-3"
      data-ingest-step-header={step ?? "management"}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold crm-text">
          {step != null ? (
            <span className="mr-2 text-slate-400">{step}.</span>
          ) : null}
          {title}
        </p>
      </div>
      {status ? (
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium",
            toneClass,
          )}
          data-ingest-step-status={tone}
        >
          {status}
        </span>
      ) : null}
    </div>
  );
}
