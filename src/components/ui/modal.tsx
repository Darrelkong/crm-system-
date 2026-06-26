import { cn } from "@/lib/cn";

export function ModalOverlay({
  className,
  children,
  onClose,
}: {
  className?: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={cn("modal-overlay", className)}>
      {onClose && (
        <button
          type="button"
          className="absolute inset-0 cursor-default"
          aria-label="Close"
          onClick={onClose}
        />
      )}
      <div className="relative z-10 w-full max-w-lg">{children}</div>
    </div>
  );
}

export function ModalPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("modal-panel p-6", className)}>{children}</div>;
}
