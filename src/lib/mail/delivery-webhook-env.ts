import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Primary delivery webhook HMAC secret — bind via Wrangler secret / env, never hardcode. */
export const MAIL_DELIVERY_WEBHOOK_SECRET_VAR =
  "MAIL_DELIVERY_WEBHOOK_SECRET" as const;

/** Optional per-provider override, e.g. MAIL_DELIVERY_WEBHOOK_SECRET_FAKE_LOCAL. */
export function deliveryWebhookProviderSecretVar(provider: string): string {
  const normalized = provider
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `MAIL_DELIVERY_WEBHOOK_SECRET_${normalized || "DEFAULT"}`;
}

export function resolveDeliveryWebhookSecret(
  env: Record<string, string | undefined>,
  provider?: string,
): string | null {
  if (provider?.trim()) {
    const providerSecret = env[deliveryWebhookProviderSecretVar(provider)]?.trim();
    if (providerSecret) {
      return providerSecret;
    }
  }
  const sharedSecret = env[MAIL_DELIVERY_WEBHOOK_SECRET_VAR]?.trim();
  return sharedSecret || null;
}

export function getDeliveryWebhookSecret(provider?: string): string | null {
  try {
    const { env } = getCloudflareContext();
    return resolveDeliveryWebhookSecret(
      env as unknown as Record<string, string | undefined>,
      provider,
    );
  } catch {
    return resolveDeliveryWebhookSecret(process.env, provider);
  }
}
