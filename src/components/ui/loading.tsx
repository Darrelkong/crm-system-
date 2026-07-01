import { cn } from "@/lib/cn";

export function LoadingSpinner({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-4 w-4 border-2",
    md: "h-6 w-6 border-2",
    lg: "h-8 w-8 border-[3px]",
  };

  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block animate-spin rounded-full crm-spinner",
        sizes[size],
        className,
      )}
    />
  );
}

export function LoadingState({ message }: { message: string }) {
  return (
    <div className="surface-card flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <LoadingSpinner size="lg" />
      <p className="text-sm crm-text-secondary">{message}</p>
    </div>
  );
}
