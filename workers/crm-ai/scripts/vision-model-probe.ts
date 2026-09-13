/**
 * Quick availability probe for B1.2 vision candidates (synthetic image only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { CrmAiEnv } from "../src/types";

const FIXTURE = join(
  import.meta.dirname,
  "../fixtures/vision-benchmark/A-simplified-chinese-banking.png",
);

const MODELS = [
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/moondream/moondream3.1-9B-A2B",
  "@cf/moonshotai/kimi-k2.6",
] as const;

function toDataUri(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function probeGemma(env: CrmAiEnv, image: Buffer) {
  const dataUri = toDataUri(image);
  return env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe all visible text exactly." },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ],
    max_tokens: 512,
    temperature: 0.1,
  });
}

async function probeMoondream(env: CrmAiEnv, image: Buffer) {
  return env.AI.run("@cf/moondream/moondream3.1-9B-A2B", {
    task: "query",
    image: [...image],
    question: "Transcribe all visible text exactly, line by line.",
    reasoning: false,
    stream: false,
    temperature: 0.1,
    max_tokens: 1024,
  });
}

async function probeKimi(env: CrmAiEnv, image: Buffer) {
  const dataUri = toDataUri(image);
  return env.AI.run("@cf/moonshotai/kimi-k2.6", {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe all visible text exactly." },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ],
    max_tokens: 512,
    temperature: 0.1,
  });
}

async function main() {
  const image = readFileSync(FIXTURE);
  const proxy = await getPlatformProxy<{ AI: Ai }>({
    configPath: "workers/crm-ai/wrangler.jsonc",
    remoteBindings: true,
  });
  const env: CrmAiEnv = { AI: proxy.env.AI };
  const results: Record<string, unknown> = {};

  for (const model of MODELS) {
    const startedAt = Date.now();
    try {
      let raw: unknown;
      if (model.includes("gemma")) raw = await probeGemma(env, image);
      else if (model.includes("moondream")) raw = await probeMoondream(env, image);
      else raw = await probeKimi(env, image);
      results[model] = {
        callable: true,
        durationMs: Date.now() - startedAt,
        keys: raw && typeof raw === "object" ? Object.keys(raw as object) : [],
        preview: JSON.stringify(raw).slice(0, 400),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results[model] = {
        callable: false,
        durationMs: Date.now() - startedAt,
        licenseRequired: /agree|license|terms/i.test(message),
        paidRequired: /paid|billing|credit|payment|quota/i.test(message),
        error: message.slice(0, 400),
      };
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await proxy.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
