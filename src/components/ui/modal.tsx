"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Full-screen modal backdrop. Portaled to document.body so z-index competes
 * with other body-level layers (e.g. security watermark at z-index 55).
 */
export function ModalOverlay({
  className,
  children,
  onClose,
}: {
  className?: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
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
    </div>,
    document.body,
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
