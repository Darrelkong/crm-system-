/** Prefer formal display name; fall back to email so the tile never errors. */
export function resolveWatermarkDisplayName(
  displayName: string | null | undefined,
  email: string,
): string {
  const name = displayName?.trim();
  if (name) return name;
  const mail = email.trim();
  return mail || "—";
}

export function buildWatermarkIdentityLine(
  displayName: string | null | undefined,
  email: string,
): string {
  const name = resolveWatermarkDisplayName(displayName, email);
  const mail = email.trim() || "—";
  if (name === mail) return mail;
  return `${name} · ${mail}`;
}

const APPROX_CHAR_WIDTH = 0.58;

function widthAt(size: number, value: string): number {
  return value.length * APPROX_CHAR_WIDTH * size;
}

/**
 * Fit long identity strings into a tile: shrink font first, then truncate.
 * Email-like strings keep the domain when possible.
 */
export function fitWatermarkIdentity(
  text: string,
  maxWidthPx: number,
  baseFontPx: number,
  minFontPx: number,
): { text: string; fontSize: number } {
  if (widthAt(baseFontPx, text) <= maxWidthPx) {
    return { text, fontSize: baseFontPx };
  }

  const fontSize = Math.max(
    minFontPx,
    (maxWidthPx / (text.length * APPROX_CHAR_WIDTH)) * 0.98,
  );

  if (widthAt(fontSize, text) <= maxWidthPx) {
    return { text, fontSize };
  }

  const maxChars = Math.max(
    12,
    Math.floor(maxWidthPx / (APPROX_CHAR_WIDTH * fontSize)),
  );
  return { text: truncateIdentity(text, maxChars), fontSize };
}

/**
 * Desktop first line is `identity · time` at one font size.
 * Shrink the whole line before truncating identity, so short emails stay readable.
 */
export function fitWatermarkDesktopFirstLine(
  identity: string,
  timeLabel: string,
  maxWidthPx: number,
  baseFontPx: number,
  minFontPx: number,
): { identityText: string; fontSize: number } {
  const joiner = " · ";
  const combined = (id: string) => `${id}${joiner}${timeLabel}`;

  if (widthAt(baseFontPx, combined(identity)) <= maxWidthPx) {
    return { identityText: identity, fontSize: baseFontPx };
  }

  const fontSize = Math.max(
    minFontPx,
    (maxWidthPx / (combined(identity).length * APPROX_CHAR_WIDTH)) * 0.98,
  );

  if (widthAt(fontSize, combined(identity)) <= maxWidthPx) {
    return { identityText: identity, fontSize };
  }

  const timePartLen = joiner.length + timeLabel.length;
  const maxChars = Math.max(
    8,
    Math.floor(maxWidthPx / (APPROX_CHAR_WIDTH * fontSize)) - timePartLen,
  );
  return {
    identityText: truncateIdentity(identity, maxChars),
    fontSize,
  };
}

/**
 * Truncate while preferring to keep `@domain` intact for email identity lines.
 * For `Name · email` lines, prefer shortening the name before the email local part.
 */
export function truncateIdentity(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;

  const sep = " · ";
  const sepIdx = value.indexOf(sep);
  const at = value.lastIndexOf("@");

  if (sepIdx > 0 && at > sepIdx) {
    const name = value.slice(0, sepIdx);
    const email = value.slice(sepIdx + sep.length);
    const emailBudget = Math.min(email.length, Math.max(10, maxChars - 4));
    let keptEmail = email;
    if (email.length > emailBudget) {
      keptEmail = truncateIdentity(email, emailBudget);
    }
    const nameBudget = maxChars - sep.length - keptEmail.length;
    if (nameBudget >= 2) {
      const keptName =
        name.length > nameBudget
          ? `${name.slice(0, Math.max(1, nameBudget - 1))}…`
          : name;
      return `${keptName}${sep}${keptEmail}`;
    }
    return truncateIdentity(email, maxChars);
  }

  if (at > 0) {
    const domain = value.slice(at);
    // Keep domain + ellipsis + at least a few local/prefix chars.
    if (domain.length + 5 <= maxChars) {
      const budget = maxChars - domain.length - 1;
      const head = value.slice(0, at);
      if (head.length > budget) {
        return `${head.slice(0, Math.max(3, budget))}…${domain}`;
      }
    }
  }

  const keep = Math.max(8, maxChars - 1);
  const head = Math.max(3, Math.ceil(keep * 0.45));
  const tail = Math.max(3, keep - head);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
