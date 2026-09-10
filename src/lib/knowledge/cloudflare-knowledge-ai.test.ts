import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  KNOWLEDGE_CLOUDFLARE_AI_MODEL,
  callKnowledgeOrganizeCloudflareAi,
  callKnowledgeQaCloudflareAi,
} from "@/lib/knowledge/cloudflare-knowledge-ai";
import {
  callKnowledgeOrganizationProvider,
  KnowledgeAiProviderOutputError,
  KnowledgeAiProviderTimeoutError,
} from "@/lib/knowledge/ai-organizer-provider";
import { callKnowledgeQaProvider } from "@/lib/knowledge/ai-qa-provider";

function makeAiService(
  handler: (request: Request) => Promise<Response> | Response,
): CloudflareEnv["AI_SERVICE"] {
  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(new Request(input, init)),
  } as CloudflareEnv["AI_SERVICE"];
}

describe("Knowledge Cloudflare AI routing", () => {
  it("routes organizer through AI_SERVICE knowledge_organize task", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const aiService = makeAiService(async (request) => {
      capturedBody = (await request.json()) as Record<string, unknown>;
      return Response.json({
        ok: true,
        data: {
          title: "Title",
          summary: "Summary",
          body: "Body",
          suggestedCategory: null,
          warnings: [],
        },
        model: KNOWLEDGE_CLOUDFLARE_AI_MODEL,
      });
    });

    const data = await callKnowledgeOrganizationProvider({
      locale: "zh-Hant",
      systemPrompt: "system",
      userPrompt: "user",
      aiService,
    });

    assert.equal((data as { title: string }).title, "Title");
    assert.equal(capturedBody?.task, "knowledge_organize");
    assert.equal(capturedBody?.schemaVersion, "knowledge-organize-v1");
    assert.equal(capturedBody?.locale, "zh-Hant");
  });

  it("routes QA through AI_SERVICE knowledge_qa task", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const aiService = makeAiService(async (request) => {
      capturedBody = (await request.json()) as Record<string, unknown>;
      return Response.json({
        ok: true,
        data: {
          answer: "Answer",
          citationIds: ["article:1"],
          insufficientInformation: false,
        },
        model: KNOWLEDGE_CLOUDFLARE_AI_MODEL,
      });
    });

    const data = await callKnowledgeQaProvider({
      locale: "en",
      systemPrompt: "system",
      userPrompt: "user",
      aiService,
    });

    assert.equal((data as { answer: string }).answer, "Answer");
    assert.equal(capturedBody?.task, "knowledge_qa");
    assert.equal(capturedBody?.schemaVersion, "knowledge-qa-v1");
  });

  it("does not call Gemini helpers or require AI_API_KEY", () => {
    for (const path of [
      "src/lib/knowledge/cloudflare-knowledge-ai.ts",
      "src/lib/knowledge/ai-organizer-provider.ts",
      "src/lib/knowledge/ai-qa-provider.ts",
      "src/lib/knowledge/ai-organizer-service.ts",
      "src/lib/knowledge/qa-service.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      assert.doesNotMatch(source, /buildGeminiGenerateUrl|google_gemini|getAiApiKeyFromEnv|resolveCustomerInsightProvider/);
      assert.doesNotMatch(source, /AI_API_KEY/);
    }
  });

  it("maps unavailable Cloudflare AI to controlled failure", async () => {
    const result = await callKnowledgeOrganizeCloudflareAi({
      locale: "zh-Hant",
      systemPrompt: "system",
      userPrompt: "user",
      aiService: undefined,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.category, "unavailable");
  });

  it("maps malformed Cloudflare response to controlled failure", async () => {
    const aiService = makeAiService(async () =>
      Response.json({ ok: false, error: "invalid_output" }, { status: 503 }),
    );
    await assert.rejects(
      () =>
        callKnowledgeQaProvider({
          locale: "zh-Hant",
          systemPrompt: "system",
          userPrompt: "user",
          aiService,
        }),
      (error: unknown) => error instanceof KnowledgeAiProviderOutputError,
    );
  });

  it("maps timeout failures without Gemini fallback", async () => {
    const aiService = makeAiService(async () =>
      Response.json({ ok: false, error: "timeout" }, { status: 503 }),
    );
    await assert.rejects(
      () =>
        callKnowledgeOrganizationProvider({
          locale: "zh-Hant",
          systemPrompt: "system",
          userPrompt: "user",
          aiService,
        }),
      (error: unknown) => error instanceof KnowledgeAiProviderTimeoutError,
    );
  });

  it("keeps standard search off AI_SERVICE", () => {
    const searchRoute = readFileSync(
      join(process.cwd(), "src/app/api/knowledge/search/route.ts"),
      "utf8",
    );
    const retrieval = readFileSync(
      join(process.cwd(), "src/lib/knowledge/published-retrieval.ts"),
      "utf8",
    );
    assert.doesNotMatch(searchRoute, /AI_SERVICE|callKnowledgeQaProvider|callKnowledgeOrganizeCloudflareAi/);
    assert.doesNotMatch(retrieval, /AI_SERVICE|callKnowledgeQaProvider|callKnowledgeOrganizeCloudflareAi/);
  });

  it("keeps customer insight Gemini path unchanged", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/ai/customer-insights/service.ts"),
      "utf8",
    );
    assert.match(service, /resolveCustomerInsightProvider/);
    assert.match(service, /getEffectiveAiSettings/);
  });
});
