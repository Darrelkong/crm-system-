/**
 * Real Gemma vision validation via remote crm-ai (Workers AI proxy).
 * Does not deploy crm-system or modify crm-ai configuration.
 *
 * Usage:
 *   node --import tsx scripts/knowledge-preview-real-vision-staging.mjs [fixture-name]
 *
 * fixture-name: chase | turkey | all (default: all)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { runKnowledgeVisionExtract } from "../workers/crm-ai/src/knowledge-vision.ts";
import {
  KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION,
  KNOWLEDGE_VISION_MODEL,
} from "../workers/crm-ai/src/models.ts";

const FIXTURES = {
  chase: {
    label: "chase-private-client-screenshot",
    path: join(
      import.meta.dirname,
      "../src/lib/knowledge/test-fixtures/chase-private-client-screenshot.png",
    ),
    mimeType: "image/png",
    anchors: [
      "Chase Private Client",
      "大通私人银行账户",
      "身份证",
      "正反面",
      "护照",
      "60 天",
      "KYC",
      "15W",
      "一个月",
      "ACH",
      "10 万美元",
      "25 万美元",
      "Zelle",
      "15,000",
      "40,000",
    ],
  },
  turkey: {
    label: "turkey-hk-incorporation",
    path: join(
      import.meta.dirname,
      "../src/lib/knowledge/test-fixtures/turkey-hk-incorporation.png",
    ),
    mimeType: "image/png",
    anchors: ["土耳其", "ECHFRONT", "香港"],
  },
};

function anchorHits(text, anchors) {
  return Object.fromEntries(
    anchors.map((anchor) => [anchor, text.includes(anchor)]),
  );
}

async function runFixture(proxy, fixture) {
  const imageBytes = readFileSync(fixture.path);
  const imageBase64 = imageBytes.toString("base64");
  const startedAt = Date.now();
  const result = await runKnowledgeVisionExtract(
    { AI: proxy.env.AI },
    {
      task: "knowledge_vision_extract",
      schemaVersion: KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION,
      locale: "zh-Hant",
      mimeType: fixture.mimeType,
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
  const durationMs = Date.now() - startedAt;
  if (!result.ok) {
    return {
      ok: false,
      label: fixture.label,
      path: fixture.path,
      durationMs,
      error: result.error,
      model: KNOWLEDGE_VISION_MODEL,
    };
  }
  const text = result.data.text;
  return {
    ok: true,
    label: fixture.label,
    path: fixture.path,
    durationMs,
    model: result.model,
    byteSize: imageBytes.byteLength,
    parsedText: text,
    anchorHits: anchorHits(text, fixture.anchors),
    missingAnchors: fixture.anchors.filter((anchor) => !text.includes(anchor)),
  };
}

async function main() {
  const mode = process.argv[2] ?? "all";
  const selected =
    mode === "all"
      ? ["chase", "turkey"]
      : mode === "chase" || mode === "turkey"
        ? [mode]
        : null;
  if (!selected) {
    console.error("Usage: node --import tsx scripts/knowledge-preview-real-vision-staging.mjs [chase|turkey|all]");
    process.exitCode = 1;
    return;
  }

  const proxy = await getPlatformProxy({
    configPath: "workers/crm-ai/wrangler.jsonc",
    remoteBindings: true,
  });

  const reports = [];
  for (const key of selected) {
    reports.push(await runFixture(proxy, FIXTURES[key]));
  }

  console.log(
    JSON.stringify(
      {
        environment: "workers-ai-remote-crm-ai-proxy",
        stagingWorkerConfig: "wrangler.knowledge-preview.jsonc (AI_SERVICE + CRM_ALLOW_MOCK_AI=0)",
        humanImg6838Available: false,
        humanImg6838Note:
          "Human IMG_6838.png is not in repo; chase-private-client-screenshot.png is the committed real-screenshot surrogate used for Gemma validation.",
        reports,
      },
      null,
      2,
    ),
  );

  const failed = reports.some((report) => !report.ok);
  const chaseReport = reports.find((report) => report.label?.includes("chase"));
  if (chaseReport?.ok && chaseReport.missingAnchors?.length) {
    process.exitCode = 1;
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
