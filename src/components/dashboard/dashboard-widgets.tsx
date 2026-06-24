export function KpiCard({
  label,
  value,
  hint,
  variant = "default",
}: {
  label: string;
  value: number | string;
  hint?: React.ReactNode;
  variant?: "default" | "warning" | "danger";
}) {
  const styles = {
    default: "border-slate-200 bg-white",
    warning: "border-amber-200 bg-amber-50",
    danger: "border-red-200 bg-red-50",
  };
  const valueStyles = {
    default: "text-slate-900",
    warning: "text-amber-800",
    danger: "text-red-700",
  };

  return (
    <div className={`rounded-lg border p-4 ${styles[variant]}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${valueStyles[variant]}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function SimpleBarRow({
  label,
  count,
  max,
}: {
  label: string;
  count: number;
  max: number;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="font-medium text-slate-900">{count}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function RankingTable({
  title,
  columns,
  rows,
  emptyMessage = "暂无数据",
}: {
  title: string;
  columns: [string, string];
  rows: { name: string; count: number }[];
  emptyMessage?: string;
}) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-2 font-medium">{columns[0]}</th>
              <th className="pb-2 text-right font-medium">{columns[1]}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.name}>
                <td className="py-2 text-slate-800">{row.name}</td>
                <td className="py-2 text-right font-medium text-slate-900">
                  {row.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
