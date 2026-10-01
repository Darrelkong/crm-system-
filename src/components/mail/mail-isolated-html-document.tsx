"use client";

import { useEffect, useMemo, useRef } from "react";
import { buildMailIsolatedDocument, safeMailDocumentLink } from "@/lib/mail/client/mail-isolated-document";

/** Script-disabled same-origin access is solely for trusted parent measurement.
 * No sender JS, popups, forms, top-navigation or embedded resources are allowed.
 */
export function MailIsolatedHtmlDocument({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const documentHtml = useMemo(() => buildMailIsolatedDocument(html), [html]);

  useEffect(() => {
    const frame = frameRef.current;
    const container = containerRef.current;
    if (!frame || !container) return;
    let teardownDocument: (() => void) | undefined;
    const loaded = () => {
      teardownDocument?.();
      const doc = frame.contentDocument;
      if (!doc?.body.hasAttribute("data-mail-document")) return;
      let cancelled = false;
      let scheduled = 0;
      let lastWidth = -1;
      const measure = () => {
        scheduled = 0;
        if (cancelled) return;
        const width = container.clientWidth;
        if (!width) return;
        // Only reset width on actual host resize; height does not depend on the
        // iframe viewport. Wider fixed tables scroll horizontally in the host.
        if (width !== lastWidth) {
          lastWidth = width;
          frame.style.width = `${width}px`;
          frame.style.width = `${Math.max(width, doc.body.scrollWidth)}px`;
        }
        const height = Math.ceil(Math.max(doc.body.scrollHeight, doc.body.getBoundingClientRect().height));
        if (frame.style.height !== `${height}px`) frame.style.height = `${height}px`;
      };
      const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(measure); };
      const observer = new ResizeObserver(schedule);
      observer.observe(container);
      observer.observe(doc.body);
      const navigate = (event: MouseEvent) => {
        const target = event.target as Element | null;
        const anchor = target?.closest?.("a");
        if (!anchor) return;
        event.preventDefault();
        const href = safeMailDocumentLink(anchor.getAttribute("href") ?? "");
        // Trusted parent handles deliberate user clicks; the frame itself has
        // no navigation/popup privileges. Old v2 links get the same protection.
        if (href && event.isTrusted && (event.button === 0 || event.button === 1)) window.open(href, "_blank", "noopener,noreferrer");
      };
      doc.addEventListener("click", navigate);
      doc.addEventListener("auxclick", navigate);
      measure();
      teardownDocument = () => {
        cancelled = true;
        cancelAnimationFrame(scheduled);
        observer.disconnect();
        doc.removeEventListener("click", navigate);
        doc.removeEventListener("auxclick", navigate);
      };
    };
    frame.addEventListener("load", loaded);
    loaded();
    return () => { frame.removeEventListener("load", loaded); teardownDocument?.(); };
  }, [documentHtml]);

  return <div ref={containerRef} style={{ overflowX: "auto", maxWidth: "100%" }}>
    <iframe ref={frameRef} title="Email message" sandbox="allow-same-origin" referrerPolicy="no-referrer"
      srcDoc={documentHtml} scrolling="no" style={{ display: "block", width: "100%", maxWidth: "none", height: 0, border: 0 }} />
  </div>;
}
