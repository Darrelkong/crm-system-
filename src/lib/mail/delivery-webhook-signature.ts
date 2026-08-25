import { createHmac, timingSafeEqual } from "node:crypto";

/** Delivery webhook receiver constants — transport remains disabled in this phase. */
export const MAIL_DELIVERY_WEBHOOK_SIGNATURE_HEADER =
  "x-mail-delivery-signature" as const;

export const MAIL_DELIVERY_WEBHOOK_TIMESTAMP_HEADER =
  "x-mail-delivery-timestamp" as const;

export const MAIL_DELIVERY_WEBHOOK_MAX_TIMESTAMP_AGE_SECONDS_VAR =
  "MAIL_DELIVERY_WEBHOOK_MAX_TIMESTAMP_AGE_SECONDS" as const;

export const MAIL_DELIVERY_WEBHOOK_MAX_TIMESTAMP_FUTURE_SKEW_SECONDS_VAR =
  "MAIL_DELIVERY_WEBHOOK_MAX_TIMESTAMP_FUTURE_SKEW_SECONDS" as const;

export const DEFAULT_DELIVERY_WEBHOOK_MAX_TIMESTAMP_AGE_SECONDS = 300;
export const DEFAULT_DELIVERY_WEBHOOK_MAX_TIMESTAMP_FUTURE_SKEW_SECONDS = 60;

export type DeliveryWebhookRejectionReason =
  | "missing_provider"
  | "missing_body"
  | "missing_secret"
  | "missing_signature"
  | "missing_timestamp"
  | "invalid_signature_format"
  | "invalid_signature"
  | "expired_timestamp"
  | "future_timestamp";

export type DeliveryWebhookSignatureValidationResult =
  | {
      ok: true;
      mode: "hmac_sha256";
      timestampSeconds: number;
    }
  | {
      ok: false;
      reason: string;
      rejectionReason: DeliveryWebhookRejectionReason;
    };

export type DeliveryWebhookSecurityConfig = {
  webhookSecret: string | null;
  maxTimestampAgeSeconds?: number;
  maxTimestampFutureSkewSeconds?: number;
  nowMs?: number;
};

function readPositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

export function resolveDeliveryWebhookSecurityConfig(
  input: {
    webhookSecret: string | null;
    env?: Record<string, string | undefined>;
    nowMs?: number;
  },
): Required<DeliveryWebhookSecurityConfig> {
  const env = input.env ?? process.env;
  return {
    webhookSecret: input.webhookSecret,
    maxTimestampAgeSeconds: readPositiveInt(
      env[MAIL_DELIVERY_WEBHOOK_MAX_TIMESTAMP_AGE_SECONDS_VAR],
      DEFAULT_DELIVERY_WEBHOOK_MAX_TIMESTAMP_AGE_SECONDS,
    ),
    maxTimestampFutureSkewSeconds: readPositiveInt(
      env[MAIL_DELIVERY_WEBHOOK_MAX_TIMESTAMP_FUTURE_SKEW_SECONDS_VAR],
      DEFAULT_DELIVERY_WEBHOOK_MAX_TIMESTAMP_FUTURE_SKEW_SECONDS,
    ),
    nowMs: input.nowMs ?? Date.now(),
  };
}

function computeDeliveryWebhookSignatureHex(input: {
  secret: string;
  timestampSeconds: number;
  rawBody: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`${input.timestampSeconds}.${input.rawBody}`, "utf8")
    .digest("hex");
}

export function formatDeliveryWebhookSignatureHeader(input: {
  secret: string;
  timestampSeconds: number;
  rawBody: string;
}): string {
  const digest = computeDeliveryWebhookSignatureHex(input);
  return `t=${input.timestampSeconds},v1=${digest}`;
}

export function signDeliveryWebhookRequest(input: {
  secret: string;
  rawBody: string;
  timestampSeconds?: number;
}): {
  signatureHeader: string;
  timestampHeader: string;
} {
  const timestampSeconds =
    input.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const signatureHeader = formatDeliveryWebhookSignatureHeader({
    secret: input.secret,
    timestampSeconds,
    rawBody: input.rawBody,
  });
  return {
    signatureHeader,
    timestampHeader: String(timestampSeconds),
  };
}

function parseSignatureHeader(signatureHeader: string): {
  timestampSeconds: number | null;
  providedDigest: string | null;
} {
  const parts = signatureHeader.split(",").map((part) => part.trim());
  let timestampSeconds: number | null = null;
  let providedDigest: string | null = null;

  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (!key || value === undefined) {
      continue;
    }
    if (key === "t") {
      const parsed = Number.parseInt(value, 10);
      timestampSeconds = Number.isFinite(parsed) ? parsed : null;
    }
    if (key === "v1") {
      providedDigest = value.trim() || null;
    }
  }

  return { timestampSeconds, providedDigest };
}

function secureCompareHex(left: string, right: string): boolean {
  try {
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

function resolveTimestampSeconds(input: {
  signatureHeader: string | null;
  timestampHeader?: string | null;
}): number | null {
  const fromHeader = input.signatureHeader
    ? parseSignatureHeader(input.signatureHeader).timestampSeconds
    : null;
  if (fromHeader !== null) {
    return fromHeader;
  }
  if (!input.timestampHeader?.trim()) {
    return null;
  }
  const parsed = Number.parseInt(input.timestampHeader.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Provider delivery webhook security gate — HMAC, timestamp window, replay protection.
 */
export function validateDeliveryWebhookSecurity(
  input: {
    provider: string;
    signatureHeader: string | null;
    timestampHeader?: string | null;
    rawBody: string;
  },
  config: DeliveryWebhookSecurityConfig,
): DeliveryWebhookSignatureValidationResult {
  const resolved = resolveDeliveryWebhookSecurityConfig({
    webhookSecret: config.webhookSecret,
    nowMs: config.nowMs,
  });

  if (!input.provider.trim()) {
    return {
      ok: false,
      reason: "Provider identifier is required",
      rejectionReason: "missing_provider",
    };
  }
  if (!input.rawBody.trim()) {
    return {
      ok: false,
      reason: "Webhook body is required",
      rejectionReason: "missing_body",
    };
  }
  if (!resolved.webhookSecret) {
    return {
      ok: false,
      reason: "Delivery webhook secret is not configured",
      rejectionReason: "missing_secret",
    };
  }
  if (!input.signatureHeader?.trim()) {
    return {
      ok: false,
      reason: "Missing delivery webhook signature header",
      rejectionReason: "missing_signature",
    };
  }

  const parsed = parseSignatureHeader(input.signatureHeader.trim());
  const timestampSeconds = resolveTimestampSeconds(input);
  if (timestampSeconds === null) {
    return {
      ok: false,
      reason: "Missing or invalid delivery webhook timestamp",
      rejectionReason: "missing_timestamp",
    };
  }
  if (!parsed.providedDigest) {
    return {
      ok: false,
      reason: "Invalid delivery webhook signature format",
      rejectionReason: "invalid_signature_format",
    };
  }

  const nowSeconds = Math.floor(resolved.nowMs / 1000);
  const ageSeconds = nowSeconds - timestampSeconds;
  if (ageSeconds > resolved.maxTimestampAgeSeconds) {
    return {
      ok: false,
      reason: "Delivery webhook timestamp expired",
      rejectionReason: "expired_timestamp",
    };
  }
  if (ageSeconds < -resolved.maxTimestampFutureSkewSeconds) {
    return {
      ok: false,
      reason: "Delivery webhook timestamp is too far in the future",
      rejectionReason: "future_timestamp",
    };
  }

  const expectedDigest = computeDeliveryWebhookSignatureHex({
    secret: resolved.webhookSecret,
    timestampSeconds,
    rawBody: input.rawBody,
  });
  if (!secureCompareHex(parsed.providedDigest, expectedDigest)) {
    return {
      ok: false,
      reason: "Invalid delivery webhook signature",
      rejectionReason: "invalid_signature",
    };
  }

  return {
    ok: true,
    mode: "hmac_sha256",
    timestampSeconds,
  };
}
