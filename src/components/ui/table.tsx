import { cn } from "@/lib/cn";

export function TableShell({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("surface-card overflow-hidden p-0", className)}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function DataTable({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <table className={cn("w-full min-w-[640px] text-sm", className)}>{children}</table>
  );
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return <thead className="table-head">{children}</thead>;
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="crm-divide-y divide-y">{children}</tbody>;
}

export function Th({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      className={cn(
        "px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide th-label",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <td className={cn("px-4 py-3.5 td-body", className)}>{children}</td>
  );
}

export function Tr({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <tr className={cn("table-row", className)}>
      {children}
    </tr>
  );
}
