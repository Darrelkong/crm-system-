"use client";

import { mailDocumentScale, mailMediaMatches } from "@/lib/mail/client/mail-document-fit";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildMailIsolatedDocument, safeMailDocumentLink } from "@/lib/mail/client/mail-isolated-document";

import { MAIL_CID_ATTRIBUTE, decodeInertCid, mailInlineResourcePath, type MailInlineContext } from "@/lib/mail/cid-image";
import { MAIL_IMAGE_ATTRIBUTE, decodeInertImage, inertMailImages } from "@/lib/mail/inert-image";
export type MailImageLabels = { fit?: string; original?: string; unavailable?: string; blocked: string; tiny: string; load: string; privacy: string; loaded: string };
const DEFAULT_IMAGE_LABELS: MailImageLabels = { fit: "Fit to screen", original: "Original width", unavailable: "Inline image unavailable", blocked: "Image blocked for privacy", tiny: "Small image blocked", load: "Load remote images", privacy: "Loading contacts the sender’s image servers and can reveal your IP address and that you opened this message.", loaded: "Remote images enabled for this view" };

/** Script-disabled same-origin access is solely for trusted parent measurement.
 * No sender JS, popups, forms, top-navigation or embedded resources are allowed.
 */
export function MailIsolatedHtmlDocument({ html, labels = DEFAULT_IMAGE_LABELS, inlineContext }: { html: string; labels?: MailImageLabels; inlineContext?: MailInlineContext }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mediaQueriesRef = useRef(new WeakMap<CSSMediaRule, string>());
  const sizeRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<(() => void) | null>(null);
  const originalRef = useRef(false);
  const [original, setOriginal] = useState(false);
  const [canFit, setCanFit] = useState(false);
  const [loadImages, setLoadImages] = useState(false);
  const images = useMemo(() => inertMailImages(html), [html]);
  const documentHtml = useMemo(() => buildMailIsolatedDocument(html, loadImages, Boolean(inlineContext?.resources.some(resource => resource.attachmentId))), [html, loadImages, inlineContext]);

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
      for (const placeholder of doc.querySelectorAll<HTMLElement>(`span[${MAIL_CID_ATTRIBUTE}]`)) {
        const image = decodeInertCid(placeholder.getAttribute(MAIL_CID_ATTRIBUTE) ?? "");
        if (!image) continue;
        const unavailable = () => {
          placeholder.replaceChildren();
          placeholder.setAttribute("role", "img");
          placeholder.textContent = `${labels.unavailable ?? DEFAULT_IMAGE_LABELS.unavailable}${image.alt ? ` — ${image.alt}` : ""}`;
          placeholder.style.cssText = "display:inline-block;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;background:#f2f2f2;border:1px solid #ccc;padding:4px;color:#444";
          if (image.width) placeholder.style.width = `${image.width}px`;
        };
        const path = inlineContext ? mailInlineResourcePath(inlineContext, image.cid) : null;
        if (!path) { unavailable(); continue; }
        if (placeholder.querySelector("img")) continue;
        const img = doc.createElement("img");
        img.alt = image.alt;
        img.referrerPolicy = "no-referrer";
        img.style.cssText = "max-width:100%;height:auto;vertical-align:middle";
        if (image.width) img.width = image.width;
        if (image.height) img.height = image.height;
        img.addEventListener("error", unavailable, { once: true });
        // Only an application-generated, message-scoped endpoint. Never sender URLs.
        img.src = new URL(path, window.location.origin).href;
        placeholder.replaceChildren(img);
      }
      let cancelled = false;
      let scheduled = 0;
      // Pin the validated width queries to the reader width, not the expanded
      // iframe width used for proportional fitting. This preserves mobile rules
      // in mixed responsive + fixed-width messages in either presentation mode.
      const mediaRules: Array<{ rule: CSSMediaRule; query: string }> = [];
      for (const sheet of Array.from(doc.styleSheets)) {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule.type === 4) {
            const media = rule as CSSMediaRule;
            const query = mediaQueriesRef.current.get(media) ?? media.conditionText;
            mediaQueriesRef.current.set(media, query);
            mediaRules.push({ rule: media, query });
          }
        }
      }
      const measure = () => {
        scheduled = 0;
        if (cancelled) return;
        const width = container.clientWidth;
        if (!width) return;
        for (const { rule, query } of mediaRules) {
          const matches = mailMediaMatches(query, width);
          if (matches !== null) rule.media.mediaText = matches ? "all" : "not all";
        }
        frame.style.width = `${width}px`;
        const naturalWidth = Math.max(width, doc.body.scrollWidth);
        frame.style.width = `${naturalWidth}px`;
        const height = Math.ceil(Math.max(doc.body.scrollHeight, doc.body.getBoundingClientRect().height));
        const mobile = window.matchMedia("(max-width: 767px)").matches;
        const scale = mailDocumentScale(width, naturalWidth, mobile, originalRef.current);
        setCanFit(previous => previous === (mobile && naturalWidth > width + 1) ? previous : mobile && naturalWidth > width + 1);
        if (frame.style.height !== `${height}px`) frame.style.height = `${height}px`;
        frame.style.transform = `scale(${scale})`;
        if (sizeRef.current) {
          sizeRef.current.style.height = `${Math.ceil(height * scale)}px`;
          sizeRef.current.style.width = `${Math.ceil(naturalWidth * scale)}px`;
        }
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
      measureRef.current = schedule;
      window.addEventListener("resize", schedule);
      measure();
      teardownDocument = () => {
        cancelled = true;
        measureRef.current = null;
        window.removeEventListener("resize", schedule);
        cancelAnimationFrame(scheduled);
        observer.disconnect();
        doc.removeEventListener("click", navigate);
        doc.removeEventListener("auxclick", navigate);
      };
    };
    frame.addEventListener("load", loaded);
    loaded();
    return () => { frame.removeEventListener("load", loaded); teardownDocument?.(); };
  }, [documentHtml, labels, loadImages, inlineContext]);

  return <>
    {images.length > 0 && <div className="mb-3 rounded border p-3 text-sm crm-text" role="note">
      <p>{loadImages ? labels.loaded : labels.privacy}</p>
      {!loadImages && <button type="button" className="mt-2 underline" onClick={() => setLoadImages(true)}>{labels.load}</button>}
    </div>}
    {canFit && <button type="button" className="mb-2 rounded border px-3 py-2 text-sm crm-text" aria-pressed={original}
      onClick={() => { originalRef.current = !originalRef.current; setOriginal(originalRef.current); if (containerRef.current) containerRef.current.scrollLeft = 0; measureRef.current?.(); }}>
      {original ? (labels.fit ?? DEFAULT_IMAGE_LABELS.fit) : (labels.original ?? DEFAULT_IMAGE_LABELS.original)}
    </button>}
    <div ref={containerRef} style={{ overflowX: "auto", maxWidth: "100%" }}>
    <div ref={sizeRef} style={{ position: "relative", overflow: "clip", maxWidth: "none", margin: 0 }}>
    <iframe key={loadImages ? "images-enabled" : "images-blocked"} ref={frameRef} title="Email message" sandbox="allow-same-origin" referrerPolicy="no-referrer"
      srcDoc={documentHtml} scrolling="no" style={{ position: "absolute", top: 0, left: 0, display: "block", width: "100%", maxWidth: "none", height: 0, border: 0, transformOrigin: "top left" }} />
  </div></div></>;
}
