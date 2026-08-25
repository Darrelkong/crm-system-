/**
 * Server-only RFC threading helpers for outbound Reply / Reply All.
 * Does not parse full MIME — token-level sanitization only.
 */

const RFC_MESSAGE_ID_TOKEN = /<[^<>\r\n\0]+@[^<>\r\n\0]+>/g;
const MAX_REFERENCES_HEADER_LENGTH = 9_980;

export function parseRfcMessageIdTokens(raw: string | null | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const matches = raw.match(RFC_MESSAGE_ID_TOKEN);
  return matches ?? [];
}

export function sanitizeRfcMessageIdToken(
  token: string | null | undefined,
): string | null {
  if (!token?.trim()) {
    return null;
  }
  const trimmed = token.trim();
  if (/[\r\n\0]/.test(trimmed)) {
    return null;
  }
  const match = trimmed.match(/^<[^<>\r\n\0]+@[^<>\r\n\0]+>$/);
  return match ? match[0] : null;
}

function dedupeTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    const sanitized = sanitizeRfcMessageIdToken(token);
    if (!sanitized) {
      continue;
    }
    const key = sanitized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(sanitized);
  }
  return result;
}

function truncateReferencesHeader(tokens: string[]): string | null {
  if (tokens.length === 0) {
    return null;
  }
  const parts: string[] = [];
  let length = 0;
  for (const token of tokens) {
    const next = parts.length === 0 ? token : ` ${token}`;
    if (length + next.length > MAX_REFERENCES_HEADER_LENGTH) {
      break;
    }
    parts.push(parts.length === 0 ? token : token);
    length += next.length;
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Derives outbound References from source chain + source wire Message-ID.
 */
export function deriveOutboundReferencesHeader(input: {
  sourceReferencesHeader: string | null;
  sourceWireMessageId: string | null;
}): string | null {
  const sourceId = sanitizeRfcMessageIdToken(input.sourceWireMessageId);
  const chain = dedupeTokens(
    parseRfcMessageIdTokens(input.sourceReferencesHeader),
  );
  if (sourceId) {
    const key = sourceId.toLowerCase();
    if (!chain.some((token) => token.toLowerCase() === key)) {
      chain.push(sourceId);
    }
  }
  return truncateReferencesHeader(chain);
}

export function deriveOutboundInReplyTo(
  sourceWireMessageId: string | null,
): string | null {
  return sanitizeRfcMessageIdToken(sourceWireMessageId);
}

export function buildOutboundRfcThreadingHeaders(input: {
  sourceReferencesHeader: string | null;
  sourceWireMessageId: string | null;
}): { inReplyTo: string | null; referencesHeader: string | null } {
  const inReplyTo = deriveOutboundInReplyTo(input.sourceWireMessageId);
  const referencesHeader = deriveOutboundReferencesHeader(input);
  return { inReplyTo, referencesHeader };
}
