/**
 * Remote Workers AI benchmark (synthetic data only).
 * Prints aggregate counts — never prompt/response bodies.
 */
import { getPlatformProxy } from "wrangler";
import { handleCrmAiRequest } from "../src/service";
import {
  BENCHMARK_MODELS,
  MODEL_LLAMA,
  MODEL_QWEN,
} from "../src/models";
import type { CrmAiEnv } from "../src/types";

const RUNS_PER_MODEL = Number(process.env.BENCHMARK_RUNS ?? 1);

type ModelStats = {
  model: string;
  attempts: number;
  success: number;
  structuredSuccess: number;
  latenciesMs: number[];
  errors: Record<string, number>;
};

async function benchmarkModel(
  env: CrmAiEnv,
  model: string,
): Promise<ModelStats> {
  const stats: ModelStats = {
    model,
    attempts: 0,
    success: 0,
    structuredSuccess: 0,
    latenciesMs: [],
    errors: {},
  };

  for (let i = 0; i < RUNS_PER_MODEL; i++) {
    stats.attempts += 1;
    const startedAt = Date.now();
    const result = await handleCrmAiRequest(env, {
      task: "structured_probe",
      model,
    });
    stats.latenciesMs.push(Date.now() - startedAt);

    if (result.ok) {
      stats.success += 1;
      if (result.data.status === "ok" && result.data.summary.length > 0) {
        stats.structuredSuccess += 1;
      }
    } else {
      stats.errors[result.error] = (stats.errors[result.error] ?? 0) + 1;
    }
  }

  return stats;
}

function selectEvaluatedGeneralModel(
  qwen: ModelStats | undefined,
  llama: ModelStats | undefined,
): string | null {
  if (qwen && qwen.success >= 1) return MODEL_QWEN;
  if (llama && llama.success >= 1) return MODEL_LLAMA;
  return null;
}

function selectEvaluatedStructuredModel(
  qwen: ModelStats | undefined,
  llama: ModelStats | undefined,
): string | null {
  if (qwen && qwen.structuredSuccess >= 1) return MODEL_QWEN;
  if (llama && llama.structuredSuccess >= 1) return MODEL_LLAMA;
  return null;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

async function main() {
  const proxy = await getPlatformProxy<{ AI: Ai }>({
    configPath: "workers/crm-ai/wrangler.jsonc",
    remoteBindings: true,
  });

  const env: CrmAiEnv = { AI: proxy.env.AI };
  const keyPresent = Boolean(env.AI);

  const results: ModelStats[] = [];
  for (const model of BENCHMARK_MODELS) {
    results.push(await benchmarkModel(env, model));
  }

  const qwen = results.find((r) => r.model === MODEL_QWEN);
  const llama = results.find((r) => r.model === MODEL_LLAMA);

  const report = {
    AI_binding_present: keyPresent,
    gateway_id: "default",
    collectLog: false,
    qwen: qwen
      ? {
          attempts: qwen.attempts,
          success: qwen.success,
          structuredSuccess: qwen.structuredSuccess,
          avgLatencyMs: avg(qwen.latenciesMs),
          errors: qwen.errors,
        }
      : null,
    llama: llama
      ? {
          attempts: llama.attempts,
          success: llama.success,
          structuredSuccess: llama.structuredSuccess,
          avgLatencyMs: avg(llama.latenciesMs),
          errors: llama.errors,
        }
      : null,
    evaluatedGeneralModel: selectEvaluatedGeneralModel(qwen, llama),
    evaluatedStructuredModel: selectEvaluatedStructuredModel(qwen, llama),
    recommendedGeneralModel: MODEL_QWEN,
    recommendedStructuredModel: MODEL_QWEN,
  };

  console.log(JSON.stringify(report, null, 2));
  await proxy.dispose();
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "benchmark_failed",
    }),
  );
  process.exit(1);
});
