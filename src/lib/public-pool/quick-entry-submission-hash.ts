export type QuickEntryCanonicalSubmissionRow = {
  clientRowId: string;
  customerName: string;
  phone: string | null;
  /** Always present after shared normalize (default +86). */
  phoneCountryCode: string;
  wechatId: string | null;
  requestedProjectName: string;
  initialFollowUpNote: string | null;
  supplementalNote: string | null;
};

export type QuickEntryCanonicalSubmissionPayload = {
  submissionId: string;
  rows: QuickEntryCanonicalSubmissionRow[];
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Builds a stable canonical object (fixed key order) for hashing.
 * Caller MUST pass already-normalized values (trimmed; empty optionals → null).
 */
export function buildQuickEntryCanonicalSubmissionObject(
  input: QuickEntryCanonicalSubmissionPayload,
): Record<string, unknown> {
  return {
    submissionId: input.submissionId,
    rows: input.rows.map((row) => ({
      clientRowId: row.clientRowId,
      customerName: row.customerName,
      phone: row.phone,
      phoneCountryCode: row.phoneCountryCode,
      wechatId: row.wechatId,
      requestedProjectName: row.requestedProjectName,
      initialFollowUpNote: row.initialFollowUpNote,
      supplementalNote: row.supplementalNote,
    })),
  };
}

/**
 * SHA-256 hex of the canonical JSON for a quick-entry submission payload.
 * Worker-compatible via crypto.subtle (same pattern as session token hash).
 */
export async function hashQuickEntrySubmissionPayload(
  input: QuickEntryCanonicalSubmissionPayload,
): Promise<string> {
  const canonical = buildQuickEntryCanonicalSubmissionObject(input);
  const encoded = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}
