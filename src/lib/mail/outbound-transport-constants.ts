/** Explicit opt-in — production keeps outbound business-mail transport disabled. */
export const MAIL_OUTBOUND_TRANSPORT_ENABLED_VAR =
  "MAIL_OUTBOUND_TRANSPORT_ENABLED" as const;

/** Preferred transport mode selector — replaces boolean-only gate in Phase 2F-5. */
export const MAIL_OUTBOUND_TRANSPORT_MODE_VAR =
  "MAIL_OUTBOUND_TRANSPORT_MODE" as const;

export const MAIL_OUTBOUND_TRANSPORT_MODES = [
  "disabled",
  "dry_run",
  "proof_only",
  "production",
] as const;

export type MailOutboundTransportMode =
  (typeof MAIL_OUTBOUND_TRANSPORT_MODES)[number];

export function isMailOutboundTransportEnabled(
  env: Record<string, string | undefined>,
): boolean {
  return resolveMailOutboundTransportMode(env) === "production";
}

export function resolveMailOutboundTransportMode(
  env: Record<string, string | undefined>,
): MailOutboundTransportMode {
  const raw = env[MAIL_OUTBOUND_TRANSPORT_MODE_VAR]?.trim().toLowerCase();
  if (
    raw &&
    (MAIL_OUTBOUND_TRANSPORT_MODES as readonly string[]).includes(raw)
  ) {
    return raw as MailOutboundTransportMode;
  }

  // Legacy boolean: true → production, false/unset → disabled (not dry_run).
  if (env[MAIL_OUTBOUND_TRANSPORT_ENABLED_VAR] === "true") {
    return "production";
  }
  return "disabled";
}

/** Business-mail dispatch may proceed (adapter may still dry-run or production-send). */
export function isOutboundTransportDispatchAllowed(
  mode: MailOutboundTransportMode,
): boolean {
  return mode === "dry_run" || mode === "production";
}

export function isCloudflareOutboundProductionMode(
  mode: MailOutboundTransportMode,
): boolean {
  return mode === "production";
}

/** Frozen V1 provider identifier for outbound business-mail transport attempts. */
export const CLOUDFLARE_EMAIL_OUTBOUND_PROVIDER_ID =
  "cloudflare-email-sending-outbound" as const;

/** Dry-run accepted IDs — never sent to Cloudflare when transport is not production. */
export const OUTBOUND_TRANSPORT_DRY_RUN_REQUEST_PREFIX =
  "dry-run-req-" as const;

export const OUTBOUND_TRANSPORT_DRY_RUN_MESSAGE_PREFIX =
  "dry-run-msg-" as const;

/** Test-only transport provider — bypasses production safety gates. */
export const FAKE_LOCAL_OUTBOUND_TRANSPORT_PROVIDER_ID = "fake-local" as const;

export function isTestOutboundTransportProvider(providerId: string): boolean {
  return providerId === FAKE_LOCAL_OUTBOUND_TRANSPORT_PROVIDER_ID;
}
