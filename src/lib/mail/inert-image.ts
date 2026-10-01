/** Versioned, non-fetching metadata in server-sanitized HTML. Not an image URL attribute. */
export const MAIL_IMAGE_ATTRIBUTE = "data-mail-image-v1";
export type InertMailImage = { url: string; alt: string; width: number | null; height: number | null };
export function remoteImageUrl(value: string): string | null {
  if (value.length > 4096 || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !/^([a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(url.hostname) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
export function imageDimension(value: unknown): number | null {
  return typeof value === "string" && /^[1-9][0-9]{0,3}$/.test(value) && Number(value) <= 2000 ? Number(value) : null;
}
export function encodeInertImage(image: InertMailImage): string {
  return encodeURIComponent(JSON.stringify([image.url, image.alt, image.width, image.height]));
}
export function decodeInertImage(value: string): InertMailImage | null {
  if (value.length > 20000) return null;
  try {
    const data: unknown = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(data) || data.length !== 4 || typeof data[0] !== "string" || typeof data[1] !== "string" || data[1].length > 500) return null;
    const url = remoteImageUrl(data[0]);
    if (!url || data.slice(2).some(v => v !== null && (!Number.isInteger(v) || v < 1 || v > 2000))) return null;
    return { url, alt: data[1], width: data[2], height: data[3] };
  } catch { return null; }
}
/** Scan only canonical percent-encoded attributes, not arbitrary raw MIME HTML. */
export function inertMailImages(html: string): InertMailImage[] {
  const result: InertMailImage[] = [];
  const canonical = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of canonical.matchAll(/<span\b[^>]*\sdata-mail-image-v1="([^"<>]*)"[^>]*>/g)) {
    const image = decodeInertImage(match[1]);
    if (image) result.push(image);
  }
  return result;
}
