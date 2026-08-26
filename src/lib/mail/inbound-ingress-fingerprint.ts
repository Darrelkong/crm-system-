/**
 * Workers-compatible SHA-256 fingerprint for raw inbound MIME bytes.
 * Used by the Cloudflare Email ingress adapter for deterministic provider event identity.
 */
export async function computeInboundRawMimeFingerprint(
  bytes: Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Stable provider event identity for Cloudflare Email Routing retries.
 * ForwardableEmailMessage exposes no documented provider delivery id — raw SHA-256 hex is used.
 */
export function formatCloudflareEmailProviderEventId(
  rawMimeFingerprintHex: string,
): string {
  const normalized = rawMimeFingerprintHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Invalid inbound raw MIME fingerprint for provider event id");
  }
  return normalized;
}
