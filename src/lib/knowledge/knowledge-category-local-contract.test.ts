import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { handleCrmAiRequest, parseCrmAiRequestBody } from "../../../workers/crm-ai/src/service";
import worker from "../../../workers/crm-ai/src/index";
import type { CrmAiEnv } from "../../../workers/crm-ai/src/types";
import { callKnowledgeCategorySuggestCloudflareAi } from "@/lib/knowledge/cloudflare-knowledge-ai";
import { parseKnowledgeCategoryAiRawOutput } from "@/lib/knowledge/knowledge-category-ai-suggestion-schema";
import { finalizeKnowledgeCategoryAiSuggestion } from "@/lib/knowledge/knowledge-category-ai-suggestion-service";

const categoryId = "11111111-1111-4111-8111-111111111101";
const request = { task: "knowledge_category_suggest" as const, schemaVersion: "knowledge-category-suggest-v1", locale: "zh-Hans" as const, systemPrompt: "synthetic system", userPrompt: "synthetic evidence" };
const valid = { categoryId, confidenceBand: "high" };
const makeEnv = (run: () => Promise<unknown>, timeout = "1000"): CrmAiEnv => ({ AI: { run } as unknown as Ai, CRM_AI_TIMEOUT_MS: timeout });

describe("B1R category suggestion local caller/Worker contract", () => {
  const oldMock = process.env.CRM_ALLOW_MOCK_AI;
  const oldBind = process.env.CRM_ALLOW_TEST_DB_BIND;
  afterEach(() => {
    if (oldMock === undefined) delete process.env.CRM_ALLOW_MOCK_AI; else process.env.CRM_ALLOW_MOCK_AI = oldMock;
    if (oldBind === undefined) delete process.env.CRM_ALLOW_TEST_DB_BIND; else process.env.CRM_ALLOW_TEST_DB_BIND = oldBind;
  });
  for (const [name,output,expected] of [
    ["valid", valid, "suggested"],
    ["null category", { categoryId: null, confidenceBand: "low" }, "insufficient_confidence"],
    ["invalid UUID", { categoryId: "invalid-uuid", confidenceBand: "high" }, "invalid_output"],
    ["outside active list", { categoryId: "22222222-2222-4222-8222-222222222202", confidenceBand: "high" }, "invalid_output"],
  ] as const) {
    it(`${name}: application caller and Worker complete safely in memory`, async () => {
      const env = makeEnv(async () => ({ response: output }));
      const aiService = { fetch: async (_url: unknown, init: RequestInit) => {
        const parsed = parseCrmAiRequestBody(JSON.parse(String(init.body)));
        assert.ok(parsed); assert.equal(parsed.task, request.task); assert.equal(parsed.schemaVersion, request.schemaVersion);
        return worker.fetch(new Request(String(_url), init), env);
      }} as unknown as CloudflareEnv["AI_SERVICE"];
      const result = await callKnowledgeCategorySuggestCloudflareAi({ ...request, aiService });
      assert.equal(result.ok, true); if (!result.ok) throw new Error("expected service envelope");
      const finalized = finalizeKnowledgeCategoryAiSuggestion({ raw: parseKnowledgeCategoryAiRawOutput(result.data), candidates: [{ id: categoryId, name: "Synthetic category", description: null }] });
      assert.equal(finalized.status, expected);
      if (expected !== "suggested") assert.equal(finalized.resolutionSource, null);
    });
  }
  for (const [name,response] of [["malformed JSON", "{broken"], ["invalid confidence", { categoryId, confidenceBand: "certain" }]] as const) {
    it(`${name} is retried then rejected`, async () => {
      let calls = 0;
      const result = await handleCrmAiRequest(makeEnv(async () => { calls++; return { response }; }), request);
      assert.deepEqual(result, { ok: false, error: "invalid_output" }); assert.equal(calls, 2);
    });
  }
  it("invalid output followed by valid output succeeds on retry", async () => {
    let calls = 0;
    const result = await handleCrmAiRequest(makeEnv(async () => ({ response: ++calls === 1 ? "{broken" : valid })), request);
    assert.equal(result.ok, true); assert.equal(calls, 2);
  });
  it("provider error stays a controlled failure", async () => {
    const result = await handleCrmAiRequest(makeEnv(async () => { throw new Error("synthetic provider failure"); }), request);
    assert.equal(result.ok, false);
  });
  it("unresolved provider respects the deadline without retrying", async () => {
    let calls = 0;
    const result = await handleCrmAiRequest(makeEnv(async () => { calls++; return new Promise(() => {}); }), request);
    assert.deepEqual(result, { ok: false, error: "timeout" }); assert.equal(calls, 1);
  });
});
