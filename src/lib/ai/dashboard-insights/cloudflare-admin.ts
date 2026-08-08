import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AdminAiProviderContext } from "./context/admin-context";
import type { AiAnalysisLanguage } from "@/lib/settings/ai-keys";

export const CLOUDFLARE_ADMIN_AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
export const CLOUDFLARE_ADMIN_SCHEMA_VERSION = "10b-v1";

export type CloudflareAdminCallResult =
  | { ok: true; raw: unknown; model: string }
  | {
      ok: false;
      category:
        | "timeout"
        | "unavailable"
        | "invalid_response"
        | "rate_limited"
        | "internal";
    };

type CrmAiServiceResponse =
  | { ok: true; data: unknown; model: string }
  | { ok: false; error: string };

function mapCrmAiError(error: string): CloudflareAdminCallResult {
  if (error === "timeout") {
    return { ok: false, category: "timeout" };
  }
  if (error === "rate_limited") {
    return { ok: false, category: "rate_limited" };
  }
  if (error === "invalid_output") {
    return { ok: false, category: "invalid_response" };
  }
  if (error === "model_unavailable") {
    return { ok: false, category: "unavailable" };
  }
  return { ok: false, category: "internal" };
}

export async function callAdminCloudflareAi(
  context: AdminAiProviderContext,
  locale: AiAnalysisLanguage,
  aiService?: CloudflareEnv["AI_SERVICE"],
): Promise<CloudflareAdminCallResult> {
  let fetcher = aiService;
  if (!fetcher) {
    try {
      const { env } = getCloudflareContext();
      fetcher = env.AI_SERVICE;
    } catch {
      return { ok: false, category: "unavailable" };
    }
  }

  if (!fetcher) {
    return { ok: false, category: "unavailable" };
  }

  let response: Response;
  try {
    response = await fetcher.fetch("https://crm-ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "admin_management_brief",
        schemaVersion: CLOUDFLARE_ADMIN_SCHEMA_VERSION,
        locale,
        context,
      }),
    });
  } catch {
    return { ok: false, category: "timeout" };
  }

  let body: CrmAiServiceResponse;
  try {
    body = (await response.json()) as CrmAiServiceResponse;
  } catch {
    return { ok: false, category: "invalid_response" };
  }

  if (body.ok && body.data) {
    return {
      ok: true,
      raw: body.data,
      model: body.model || CLOUDFLARE_ADMIN_AI_MODEL,
    };
  }

  if (!body.ok && body.error) {
    return mapCrmAiError(body.error);
  }

  return { ok: false, category: "invalid_response" };
}
