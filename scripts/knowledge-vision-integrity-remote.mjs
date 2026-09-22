/**
 * Non-production real Workers AI vision validation for Turkey/HK synthetic fixture.
 * Uses remote crm-ai Workers AI binding — does not deploy or touch Production crm-system.
 *
 * Usage:
 *   node --import tsx scripts/knowledge-vision-integrity-remote.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { runKnowledgeVisionExtract } from "../workers/crm-ai/src/knowledge-vision.ts";
import { KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION, KNOWLEDGE_VISION_MODEL } from "../workers/crm-ai/src/models.ts";
import { assessVisionExtractionIntegrity } from "../src/lib/knowledge/knowledge-vision-integrity.ts";
import { buildVisionExtractionMetadata } from "../src/lib/knowledge/vision-extraction-metadata.ts";
import { assessVisionExtractionReliability } from "../src/lib/knowledge/knowledge-evidence-grounding.ts";
import { isKnownHallucinationBankingTemplate } from "../src/lib/knowledge/knowledge-evidence-grounding.ts";

const FIXTURE_PATH = join(
  import.meta.dirname,
  "../src/lib/knowledge/test-fixtures/turkey-hk-incorporation.png",
);

async function main() {
  const imageBytes = readFileSync(FIXTURE_PATH);
  const imageBase64 = imageBytes.toString("base64");
  const proxy = await getPlatformProxy({
    configPath: "workers/crm-ai/wrangler.jsonc",
    remoteBindings: true,
  });
  const startedAt = Date.now();
  const result = await runKnowledgeVisionExtract(
    { AI: proxy.env.AI },
    {
      task: "knowledge_vision_extract",
      schemaVersion: KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION,
      locale: "zh-Hant",
      mimeType: "image/png",
      imageBase64,
      byteSize: imageBytes.byteLength,
    },
    async (model, _task, _schemaVersion, payload, timeoutMs) =>
      proxy.env.AI.run(model, payload, {
        gateway: {
          id: "default",
          collectLog: false,
          metadata: {
            task: "knowledge_vision_extract",
            schemaVersion: KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION,
          },
        },
        timeout: timeoutMs,
      }),
    60_000,
  );

  if (!result.ok) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          model: KNOWLEDGE_VISION_MODEL,
          environment: "workers-ai-remote-proxy",
          fixture: FIXTURE_PATH,
          error: result.error,
          durationMs: Date.now() - startedAt,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const metadata = buildVisionExtractionMetadata({
    quality: result.data.quality,
    warnings: result.data.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message ?? undefined,
    })),
  });
  const integrity = assessVisionExtractionIntegrity({
    rawText: result.data.text,
    extractionMetadata: metadata,
    extractionMethod: "vision",
    extractionModel: result.model,
  });
  const reliability = assessVisionExtractionReliability({
    rawText: result.data.text,
    extractionMetadata: metadata,
    extractionMethod: "vision",
    extractionModel: result.model,
  });
  const text = result.data.text;
  const report = {
    ok: true,
    model: result.model,
    environment: "workers-ai-remote-proxy",
    fixture: FIXTURE_PATH,
    durationMs: Date.now() - startedAt,
    rawModelQuality: result.data.quality,
    rawModelWarnings: result.data.warnings,
    parsedText: text,
    textPreview: text.slice(0, 500),
    containsKnownHsbcHallucinationTemplate:
      isKnownHallucinationBankingTemplate(text),
    containsUnsupportedHsbcBankName:
      /汇丰香港|滙豐香港/.test(text) || /\bHSBC\b/i.test(text),
    containsUnsupported50WanClaim:
      /最低资产要求\s*50\s*万|最低資產要求\s*50\s*萬/.test(text),
    containsUnsupported46WeekClaim:
      /办理周期\s*4.?6\s*周|辦理週期\s*4.?6\s*週/.test(text),
    containsTurkey: /土耳其/.test(text),
    containsHkIncorporation: /ECHFRONT|香港公司註冊|Incorporation/i.test(text),
    integrity,
    organizerEligible: !reliability.requiresHumanReview,
    requiresHumanReview: reliability.requiresHumanReview,
  };
  console.log(JSON.stringify(report, null, 2));
  if (
    report.containsKnownHsbcHallucinationTemplate ||
    report.containsUnsupportedHsbcBankName ||
    report.containsUnsupported50WanClaim ||
    report.containsUnsupported46WeekClaim
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
