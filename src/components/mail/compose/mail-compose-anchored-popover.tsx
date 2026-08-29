"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const POPOVER_Z_INDEX = 120;

export function MailComposeAnchoredPopover({
  open,
  anchorRef,
  onClose,
  children,
  className,
  placement = "above",
  align = "start",
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placement?: "above" | "below";
  align?: "start" | "end";
}) {
  const [mounted, setMounted] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({
    top: 0,
    left: 0,
    visibility: "hidden",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const top =
        placement === "above" ? rect.top - margin : rect.bottom + margin;
      const left = align === "end" ? rect.right : rect.left;

      setStyle({
        position: "fixed",
        top,
        left,
        zIndex: POPOVER_Z_INDEX,
        transform:
          placement === "above"
            ? align === "end"
              ? "translate(-100%, -100%)"
              : "translateY(-100%)"
            : align === "end"
              ? "translateX(-100%)"
              : undefined,
        visibility: "visible",
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [align, anchorRef, open, placement]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      const popover = document.querySelector("[data-mail-compose-popover]");
      if (popover?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose, open]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div
      data-mail-compose-popover
      className={cn("mail-compose-anchored-popover", className)}
      style={style}
    >
      {children}
    </div>,
    document.body,
  );
}
