import {
  roundPerfMs,
  type CustomerDetailPerfTimings,
} from "@/lib/customers/customer-detail-perf";

type Props = {
  timings: CustomerDetailPerfTimings;
};

const ROWS: Array<{
  key: keyof CustomerDetailPerfTimings;
  label: string;
}> = [
  { key: "serverDataReadyTotalMs", label: "Server data-ready total" },
  { key: "authMs", label: "Auth" },
  { key: "customerLookupMs", label: "Customer lookup" },
  { key: "pendingApprovalMs", label: "Pending approval" },
  { key: "accessResolutionMs", label: "Access resolution" },
  { key: "scoringMs", label: "Scoring" },
  { key: "secondaryTotalMs", label: "Secondary total" },
  { key: "followUpsMs", label: "Follow-ups" },
  { key: "timelineMs", label: "Timeline" },
  { key: "confirmNameMs", label: "Confirm name" },
  { key: "userLabelsMs", label: "User labels" },
  { key: "assigneeNamesMs", label: "Assignee names" },
];

export function CustomerDetailPerfPanel({ timings }: Props) {
  return (
    <section
      className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950"
      aria-label="Customer Detail performance diagnostic"
    >
      <h2 className="mb-1 font-semibold">
        Customer Detail Performance Diagnostic
      </h2>
      <p className="mb-3 text-[11px] text-amber-800">
        Server page timing only. Does not include Access network latency, RSC
        transfer, browser render, or client hydration.
      </p>
      <dl className="grid gap-1 font-mono">
        {ROWS.map(({ key, label }) => (
          <div key={key} className="flex items-baseline justify-between gap-4">
            <dt>{label}</dt>
            <dd className="tabular-nums">{roundPerfMs(timings[key])}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] text-amber-800">
        Timeline duration excludes shared Follow-up load when preloaded Follow-ups
        are used.
      </p>
    </section>
  );
}
