const INVISIBLE_FOREGROUND = new Set([
  "#ffffff",
  "#fff",
  "white",
  "rgb(255, 255, 255)",
  "rgb(255,255,255)",
]);

function normalizeColorToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function isInvisibleForegroundColor(color: string | null | undefined): boolean {
  if (!color) return false;
  return INVISIBLE_FOREGROUND.has(normalizeColorToken(color));
}

/**
 * Rewrites pasted HTML foreground colors that would be invisible on the light
 * compose editor surface. Preserves other formatting.
 */
export function normalizeInvisiblePastedForeground(html: string): string {
  if (!html.trim()) {
    return html;
  }

  let normalized = html
    .replace(/color\s*:\s*#ffffff\b/gi, "")
    .replace(/color\s*:\s*#fff\b/gi, "")
    .replace(/color\s*:\s*white\b/gi, "")
    .replace(/color\s*:\s*rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/gi, "");

  if (typeof DOMParser === "undefined") {
    return normalized;
  }

  const doc = new DOMParser().parseFromString(normalized, "text/html");
  const elements = doc.body.querySelectorAll<HTMLElement>("*");

  for (const element of elements) {
    const styleAttr = element.getAttribute("style");
    if (styleAttr && /color\s*:\s*#?fff(ff)?\b/i.test(styleAttr)) {
      element.style.removeProperty("color");
      if (!element.getAttribute("style")?.trim()) {
        element.removeAttribute("style");
      }
    }

    const inlineColor = element.style.color;
    if (isInvisibleForegroundColor(inlineColor)) {
      element.style.removeProperty("color");
      if (!element.getAttribute("style")?.trim()) {
        element.removeAttribute("style");
      }
    }

    const colorAttr = element.getAttribute("color");
    if (colorAttr && isInvisibleForegroundColor(colorAttr)) {
      element.removeAttribute("color");
    }
  }

  return doc.body.innerHTML;
}
