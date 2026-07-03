import { cn } from "@/lib/cn";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[#E2E8F0] dark:bg-[#334155]",
        className,
      )}
      aria-hidden
      {...props}
    />
  );
}
