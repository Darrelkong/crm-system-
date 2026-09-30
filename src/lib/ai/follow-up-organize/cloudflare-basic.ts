import { getCloudflareContext } from "@opennextjs/cloudflare";
import { BASIC_FLUENCY_VERSION, basicFluencyLocale, parseBasicFluencyOutput } from "./fluency-contract";
import { emptyExtracted, type FollowUpOrganizationResult } from "./types";

export class BasicOrganizeError extends Error {
  readonly code = "BASIC_ORGANIZE_UNAVAILABLE";
  constructor() { super("Basic organization unavailable; original retained"); }
}
export type BasicAiService = { fetch(input: string, init: RequestInit): Promise<Response> };

export async function organizeBasicWithCloudflare(
  text: string, locale: unknown, generatedAt: string, service?: BasicAiService,
): Promise<FollowUpOrganizationResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const binding = service ?? getCloudflareContext().env.AI_SERVICE;
    if (!binding) throw new BasicOrganizeError();
    // Bound response waiting as well as the provider invocation. No client/adapter retries.
    const operation = async () => {
      const response = await binding.fetch("https://crm-ai/", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ task: "basic_text_organize", schemaVersion: BASIC_FLUENCY_VERSION, locale: basicFluencyLocale(locale), text }),
      });
      if (!response.ok) throw new BasicOrganizeError();
      const body = await response.json() as { ok?: unknown; data?: unknown };
      const data = body?.ok === true ? parseBasicFluencyOutput(body.data, text) : null;
      if (!data) throw new BasicOrganizeError();
      return data;
    };
    const data = await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new BasicOrganizeError()); }, 23_000);
    })]);
    return { source: "cloudflare_ai", originalText: text, organizedText: data.text,
      extracted: emptyExtracted(), warnings: [], generatedAt };
  } catch {
    // Do not pass provider text, input, output, or exceptions to logs/users.
    throw new BasicOrganizeError();
  } finally { if (timer) clearTimeout(timer); }
}
