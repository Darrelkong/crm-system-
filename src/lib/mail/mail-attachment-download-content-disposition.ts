import { normalizeAttachmentFilename } from "@/lib/mail/compose-attachment-policy";

const DEFAULT_ATTACHMENT_FILENAME = "attachment";

function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "");
}

function toAsciiFilenameFallback(filename: string): string {
  const stripped = stripControlCharacters(filename)
    .replace(/\\/g, "_")
    .replace(/"/g, "_")
    .replace(/;/g, "_");
  const ascii = stripped.replace(/[^\x20-\x7E]/g, "_").trim();
  if (!ascii || ascii === "." || ascii === "..") {
    return DEFAULT_ATTACHMENT_FILENAME;
  }
  return ascii.slice(0, 180);
}

function encodeRFC5987Filename(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function resolveMailAttachmentDownloadFilename(input: {
  displayFilename: string;
  originalFilename: string;
}): string {
  const normalizedDisplay = normalizeAttachmentFilename(input.displayFilename);
  if (normalizedDisplay) {
    return stripControlCharacters(normalizedDisplay);
  }
  const normalizedOriginal = normalizeAttachmentFilename(input.originalFilename);
  if (normalizedOriginal) {
    return stripControlCharacters(normalizedOriginal);
  }
  return DEFAULT_ATTACHMENT_FILENAME;
}

export function buildMailAttachmentContentDispositionHeader(
  filename: string,
  disposition: "inline" | "attachment" = "attachment",
): string {
  const sanitized = resolveMailAttachmentDownloadFilename({
    displayFilename: filename,
    originalFilename: filename,
  });
  const asciiFallback = toAsciiFilenameFallback(sanitized);
  const encoded = encodeRFC5987Filename(sanitized);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
