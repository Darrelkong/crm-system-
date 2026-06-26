import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getAiApiKeyFromEnv(): string | undefined {
  try {
    const { env } = getCloudflareContext();
    const key = env.AI_API_KEY?.trim();
    return key || undefined;
  } catch {
    const key = process.env.AI_API_KEY?.trim();
    return key || undefined;
  }
}

export function isAiApiKeyConfigured(): boolean {
  return !!getAiApiKeyFromEnv();
}
