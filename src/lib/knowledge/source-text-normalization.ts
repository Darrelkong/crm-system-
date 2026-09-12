/**
 * Canonical text normalization for Knowledge source ingest and exact-text dedup.
 * Conservative: layout only, never semantic rewriting.
 */
export function normalizeKnowledgeSourceText(text: string): string {
  let normalized = text.replace(/\r\n?/g, "\n");
  normalized = normalized.replace(/\u0000/g, "");
  normalized = normalized.replace(/\n{4,}/g, "\n\n\n");
  normalized = normalized.replace(/[ \t]+$/gm, "");
  return normalized.trim();
}

export function isMeaningfulKnowledgeSourceText(text: string): boolean {
  return normalizeKnowledgeSourceText(text).length > 0;
}
