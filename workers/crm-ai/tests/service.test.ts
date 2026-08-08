import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  handleCrmAiRequest,
  parseCrmAiRequestBody,
  runHealthProbe,
} from "../src/service";
import {
  MODEL_LLAMA,
  MODEL_QWEN,
} from "../src/models";
import { validateHealthProbeOutput } from "../src/validate";
import type { CrmAiEnv } from "../src/types";

function makeEnv(
  runImpl: (model: string, payload: unknown, options: unknown) => Promise<unknown>,
): CrmAiEnv {
  return {
    AI: {
      run: runImpl,
    } as unknown as Ai,
  };
}

describe("crm-ai validation", () => {
  it("accepts valid health probe output", () => {
    assert.equal(
      validateHealthProbeOutput({ status: "ok", summary: "今日跟进良好。" }),
      true,
    );
  });

  it("rejects invalid health probe output", () => {
    assert.equal(validateHealthProbeOutput({ status: "bad" }), false);
    assert.equal(validateHealthProbeOutput(null), false);
    assert.equal(
      validateHealthProbeOutput({ status: "ok", summary: "" }),
      false,
    );
  });
});

describe("crm-ai request parsing", () => {
  it("parses probe tasks", () => {
    assert.deepEqual(parseCrmAiRequestBody({ task: "health_probe" }), {
      task: "health_probe",
      model: undefined,
    });
    assert.deepEqual(
      parseCrmAiRequestBody({
        task: "structured_probe",
        model: MODEL_QWEN,
      }),
      { task: "structured_probe", model: MODEL_QWEN },
    );
    assert.equal(parseCrmAiRequestBody({ task: "other" }), null);
  });
});

describe("crm-ai service contract", () => {
  it("returns structured success from Workers AI response wrapper", async () => {
    const env = makeEnv(async () => ({
      response: { status: "ok", summary: "新增3，跟进8，风险2。" },
    }));
    const result = await handleCrmAiRequest(env, {
      task: "health_probe",
      model: MODEL_LLAMA,
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected success");
    assert.equal(result.model, MODEL_LLAMA);
    assert.equal(result.data.status, "ok");
  });

  it("maps invalid JSON to invalid_output", async () => {
    const env = makeEnv(async () => ({ response: { status: "bad" } }));
    const result = await handleCrmAiRequest(env, {
      task: "structured_probe",
      model: MODEL_LLAMA,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.error, "invalid_output");
  });

  it("maps abort to timeout", async () => {
    const env = makeEnv(async () => {
      throw new DOMException("Aborted", "AbortError");
    });
    const result = await handleCrmAiRequest(env, {
      task: "health_probe",
      model: MODEL_QWEN,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.error, "timeout");
  });

  it("maps cloudflare error code 3007 to timeout", async () => {
    const env = makeEnv(async () => {
      const error = new Error("inference timeout") as Error & { code: number };
      error.code = 3007;
      throw error;
    });
    const result = await handleCrmAiRequest(env, {
      task: "health_probe",
      model: MODEL_QWEN,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.error, "timeout");
  });

  it("maps cloudflare error code 3008 to timeout", async () => {
    const env = makeEnv(async () => {
      const error = new Error("inference aborted") as Error & { code: number };
      error.code = 3008;
      throw error;
    });
    const result = await handleCrmAiRequest(env, {
      task: "structured_probe",
      model: MODEL_QWEN,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.error, "timeout");
  });

  it("resolves timeout when AI.run never settles", async () => {
    const env: CrmAiEnv = {
      AI: {
        run: () => new Promise(() => {}),
      } as unknown as Ai,
      CRM_AI_TIMEOUT_MS: "50",
    };

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const startedAt = Date.now();
      const result = await runHealthProbe(env);
      assert.equal(result.ok, false);
      if (result.ok) throw new Error("expected failure");
      assert.equal(result.error, "timeout");
      assert.ok(Date.now() - startedAt < 500, "should use short test deadline");

      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(unhandled.length, 0, "late provider promise must not reject");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("retries at most once on invalid_output", async () => {
    let calls = 0;
    const env = makeEnv(async () => {
      calls += 1;
      return { response: { status: "bad" } };
    });
    const result = await handleCrmAiRequest(env, {
      task: "structured_probe",
      model: MODEL_LLAMA,
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 2);
  });

  it("defaults structured_probe to qwen when model omitted", async () => {
    let seenModel = "";
    const env = makeEnv(async (model) => {
      seenModel = model;
      return { response: { status: "ok", summary: "ok" } };
    });
    await handleCrmAiRequest(env, { task: "structured_probe" });
    assert.equal(seenModel, MODEL_QWEN);
  });
});

describe("crm-ai architecture guards", () => {
  it("does not log prompts in logging output fields", () => {
    const source = readFileSync("workers/crm-ai/src/logging.ts", "utf8");
    assert.doesNotMatch(source, /console\.(info|log|error)\([^)]*prompt/i);
    assert.doesNotMatch(source, /console\.(info|log|error)\([^)]*response/i);
    assert.match(source, /task: entry\.task/);
  });

  it("wrangler config has no public route or CRM bindings", () => {
    const config = readFileSync("workers/crm-ai/wrangler.jsonc", "utf8");
    assert.match(config, /"name": "crm-ai"/);
    assert.match(config, /"workers_dev": false/);
    assert.match(config, /"binding": "AI"/);
    assert.doesNotMatch(config, /d1_databases/);
    assert.doesNotMatch(config, /r2_buckets/);
    assert.doesNotMatch(config, /routes/);
    assert.doesNotMatch(config, /custom_domain/);
  });

  it("index only accepts POST and has no customer insight task", () => {
    const source = readFileSync("workers/crm-ai/src/index.ts", "utf8");
    assert.match(source, /request.method !== "POST"/);
    assert.doesNotMatch(source, /customer_insight/);
  });
});
