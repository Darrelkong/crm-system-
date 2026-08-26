/** Cloudflare Email Routing provider identity for inbound staging dedupe. */
export const CLOUDFLARE_EMAIL_ROUTING_PROVIDER = "cloudflare-email-routing" as const;

/**
 * Cloudflare Email Routing hard inbound MIME ceiling (25 MiB total message).
 * Product V1 inbound cap aligns with provider limit — no larger local cap.
 */
export const INBOUND_MIME_MAX_BYTES = 25 * 1024 * 1024;

/** Per-attachment ceiling — cannot exceed accepted total MIME size. */
export const INBOUND_ATTACHMENT_MAX_BYTES = INBOUND_MIME_MAX_BYTES;
