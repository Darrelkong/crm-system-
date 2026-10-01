"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildMailIsolatedDocument, safeMailDocumentLink } from "@/lib/mail/client/mail-isolated-document";

import { MAIL_IMAGE_ATTRIBUTE, decodeInertImage, inertMailImages } from "@/lib/mail/inert-image";
export type MailImageLabels = { blocked: string; tiny: string; load: string; privacy: string; loaded: string };
const DEFAULT_IMAGE_LABELS: MailImageLabels = { blocked: "Image blocked for privacy", tiny: "Small image blocked", load: "Load remote images", privacy: "Loading contacts the sender’s image servers and can reveal your IP address and that you opened this message.", loaded: "Remote images enabled for this view" };

/** Script-disabled same-origin access is solely for trusted parent measurement.
 * No sender JS, popups, forms, top-navigation or embedded resources are allowed.
 */
export function MailIsolatedHtmlDocument({ html, labels = DEFAULT_IMAGE_LABELS }: { html: string; labels?: MailImageLabels }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadImages, setLoadImages] = useState(false);
  const images = useMemo(() => inertMailImages(html), [html]);
  const documentHtml = useMemo(() => buildMailIsolatedDocument(html, loadImages), [html, loadImages]);

  useEffect(() => {
    const frame = frameRef.current;
    const container = containerRef.current;
    if (!frame || !container) return;
    let teardownDocument: (() => void) | undefined;
    const loaded = () => {
      teardownDocument?.();
      const doc = frame.contentDocument;
      if (!doc?.body.hasAttribute("data-mail-document") || doc.body.dataset.mailImages !== (loadImages ? "enabled" : "blocked")) return;
      for (const placeholder of doc.querySelectorAll<HTMLElement>(`span[${MAIL_IMAGE_ATTRIBUTE}]`)) {
        const image = decodeInertImage(placeholder.getAttribute(MAIL_IMAGE_ATTRIBUTE) ?? "");
        if (!image) continue;
        // Trusted DOM construction: no innerHTML, srcset, CSS URLs or sender events.
        if (loadImages && placeholder.querySelector("img")) continue;
        placeholder.replaceChildren();
        const tiny = image.width !== null && image.height !== null && image.width <= 4 && image.height <= 4;
        if (loadImages) {
          const img = doc.createElement("img");
          img.alt = image.alt || labels.blocked;
          img.referrerPolicy = "no-referrer";
          img.style.cssText = "max-width:100%;height:auto;vertical-align:middle";
          if (image.width) img.width = image.width;
          if (image.height) img.height = image.height;
          img.src = image.url;
          placeholder.append(img);
        } else {
          placeholder.setAttribute("role", "img");
          placeholder.setAttribute("aria-label", `${labels.blocked}${image.alt ? `: ${image.alt}` : ""}`);
          placeholder.style.cssText = "display:inline-block;box-sizing:border-box;max-width:100%;overflow-wrap:anywhere;color:#444;background:#f2f2f2;border:1px solid #ccc;padding:4px;font:14px/1.5 Arial,sans-serif;vertical-align:middle";
          if (!tiny && image.width) placeholder.style.width = `${image.width}px`;
          placeholder.textContent = `${tiny ? labels.tiny : labels.blocked}${image.alt ? ` — ${image.alt}` : ""}`;
        }
      }
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
  }, [documentHtml, labels, loadImages]);

  return <>
    {images.length > 0 && <div className="mb-3 rounded border p-3 text-sm crm-text" role="note">
      <p>{loadImages ? labels.loaded : labels.privacy}</p>
      {!loadImages && <button type="button" className="mt-2 underline" onClick={() => setLoadImages(true)}>{labels.load}</button>}
    </div>}
    <div ref={containerRef} style={{ overflowX: "auto", maxWidth: "100%" }}>
    <iframe key={loadImages ? "images-enabled" : "images-blocked"} ref={frameRef} title="Email message" sandbox="allow-same-origin" referrerPolicy="no-referrer"
      srcDoc={documentHtml} scrolling="no" style={{ display: "block", width: "100%", maxWidth: "none", height: 0, border: 0 }} />
  </div></>;
}
