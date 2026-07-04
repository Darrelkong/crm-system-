import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import {
  CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA,
  CUSTOMER_INSIGHT_JSON_SCHEMA,
} from "@/lib/ai/customer-insights/json-schema";
import { customerInsightOutputSchema, safeParseCustomerInsightOutput } from "@/lib/ai/customer-insights/schema";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import {
  buildGeminiGenerateUrl,
  googleGeminiCustomerInsightProvider,
} from "./google-gemini";
import {
  getCustomerInsightProviderImpl,
  resolveCustomerInsightProvider,
} from "./factory";
import { openAiCompatibleCustomerInsightProvider } from "./openai-compatible";
import { mockCustomerInsightProvider } from "./mock";
import type { ResolvedCustomerInsightProvider } from "./types";

const SECRET_API_KEY = "AIzaSy-gemini-secret-key-do-not-log";
const SENSITIVE_CUSTOMER_NAME = "张三敏感客户";

const runtimeConfig = {
  apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  model: "gemini-3.5-flash",
  temperature: 0.2,
  maxTokens: 2048,
  timeoutMs: 30_000,
  apiKey: SECRET_API_KEY,
};

const settings = {
  aiAnalysisLanguage: "zh-Hans",
  aiPromptTemplate: "分析客户：{{context_json}}",
  aiPromptVersion: "test-v1",
} as EffectiveAiSettings;

const context: CustomerInsightContext = {
  customerId: "customer-uuid",
  customerName: SENSITIVE_CUSTOMER_NAME,
  customerType: "individual",
  salesStage: "lead",
  source: "web",
  status: "active",
  requestedProjectName: null,
  sourceRemark: null,
  notes: null,
  lastFollowUpAt: null,
  lastValidFollowUpAt: null,
  nextFollowUpAt: null,
  updatedAt: "2026-07-04T00:00:00.000Z",
  includeSensitiveFields: true,
  phone: "13800138000",
  wechatId: null,
  email: "sensitive@example.com",
  recentFollowUps: [],
};

const validInsightPayload = {
  intentLevel: "medium",
  intentScore: 55,
  customerSummary: "summary",
  currentSituation: "situation",
  keySignals: ["signal"],
  riskFlags: [],
  missingInformation: [],
  nextBestAction: "action",
  suggestedFollowUpAt: null,
  suggestedEmployeeMessage: "message",
  confidence: 0.6,
  reasoning: "reason",
};

function assertNoSecrets(serialized: string): void {
  assert.equal(serialized.includes(SECRET_API_KEY), false);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("Authorization"), false);
  assert.equal(serialized.includes(SENSITIVE_CUSTOMER_NAME), false);
  assert.equal(serialized.includes("13800138000"), false);
  assert.equal(serialized.includes("sensitive@example.com"), false);
}

function makeSuccessResponse(text: string): Response {
  return Response.json(
    {
      candidates: [
        {
          content: { parts: [{ text }], role: "model" },
          finishReason: "STOP",
        },
      ],
    },
    { status: 200 },
  );
}

function parseRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  assert.equal(typeof init?.body, "string");
  return JSON.parse(init!.body as string) as Record<string, unknown>;
}

async function expectProviderError(
  fetchImpl: typeof fetch,
  assertDiagnostics: (error: AiProviderError) => void,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;

  try {
    await assert.rejects(
      () =>
        googleGeminiCustomerInsightProvider.analyzeCustomerInsight(
          context,
          settings,
          runtimeConfig,
        ),
      (error: unknown) => {
        assert.equal(error instanceof AiProviderError, true);
        assertDiagnostics(error as AiProviderError);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("buildGeminiGenerateUrl", () => {
  it("builds correct URL from base URL and model", () => {
    assert.equal(
      buildGeminiGenerateUrl("https://generativelanguage.googleapis.com/v1beta", "gemini-3.5-flash"),
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    );
  });

  it("strips trailing slash from base URL", () => {
    assert.equal(
      buildGeminiGenerateUrl("https://generativelanguage.googleapis.com/v1beta/", "gemini-3.5-flash"),
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    );
  });
});

describe("googleGeminiCustomerInsightProvider request structure", () => {
  it("request URL is /v1beta/models/gemini-3.5-flash:generateContent", async () => {
    let capturedUrl: string | undefined;
    const fetchMock = mock.fn(async (url: unknown) => {
      capturedUrl = String(url);
      return makeSuccessResponse(JSON.stringify(validInsightPayload));
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(context, settings, runtimeConfig);
      assert.equal(
        capturedUrl,
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses x-goog-api-key header and does not use Authorization: Bearer", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchMock = mock.fn(async (_url: unknown, init: unknown) => {
      capturedHeaders = (init as RequestInit).headers as Record<string, string>;
      return makeSuccessResponse(JSON.stringify(validInsightPayload));
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(context, settings, runtimeConfig);
      assert.equal(capturedHeaders?.["x-goog-api-key"], SECRET_API_KEY);
      assert.equal(capturedHeaders?.["Authorization"], undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("request body contains generationConfig.responseMimeType = application/json", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = mock.fn(async (_url: unknown, init: unknown) => {
      capturedBody = parseRequestBody(init as RequestInit);
      return makeSuccessResponse(JSON.stringify(validInsightPayload));
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(context, settings, runtimeConfig);
      assert.ok(capturedBody !== null);
      const gc = (capturedBody as Record<string, unknown>).generationConfig as Record<string, unknown>;
      assert.equal(gc.responseMimeType, "application/json");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("request body contains generationConfig.responseSchema", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = mock.fn(async (_url: unknown, init: unknown) => {
      capturedBody = parseRequestBody(init as RequestInit);
      return makeSuccessResponse(JSON.stringify(validInsightPayload));
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(context, settings, runtimeConfig);
      assert.ok(capturedBody !== null);
      const gc = (capturedBody as Record<string, unknown>).generationConfig as Record<string, unknown>;
      assert.deepEqual(gc.responseSchema, CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("request body contains systemInstruction.parts[0].text", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = mock.fn(async (_url: unknown, init: unknown) => {
      capturedBody = parseRequestBody(init as RequestInit);
      return makeSuccessResponse(JSON.stringify(validInsightPayload));
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(context, settings, runtimeConfig);
      assert.ok(capturedBody !== null);
      assert.equal((capturedBody as Record<string, unknown>).system_instruction, undefined);
      const si = (capturedBody as Record<string, unknown>).systemInstruction as {
        parts: Array<{ text: string }>;
      };
      assert.equal(typeof si.parts[0].text, "string");
      assert.ok(si.parts[0].text.length > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maxOutputTokens uses effective maxTokens (2048), not a hardcoded value", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = mock.fn(async (_url: unknown, init: unknown) => {
      capturedBody = parseRequestBody(init as RequestInit);
      return makeSuccessResponse(JSON.stringify(validInsightPayload));
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(context, settings, runtimeConfig);
      assert.ok(capturedBody !== null);
      const gc = (capturedBody as Record<string, unknown>).generationConfig as Record<string, unknown>;
      assert.equal(gc.maxOutputTokens, runtimeConfig.maxTokens);
      assert.notEqual(gc.maxOutputTokens, 1200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("googleGeminiCustomerInsightProvider success path", () => {
  it("parses candidates[0].content.parts[0].text as JSON", async () => {
    const fetchMock = mock.fn(async () => makeSuccessResponse(JSON.stringify(validInsightPayload)));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const result = await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(
        context,
        settings,
        runtimeConfig,
      );
      assert.deepEqual(result, validInsightPayload);
      assert.equal(fetchMock.mock.calls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parsed result passes customerInsightOutputSchema validation", async () => {
    const fetchMock = mock.fn(async () => makeSuccessResponse(JSON.stringify(validInsightPayload)));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const result = await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(
        context,
        settings,
        runtimeConfig,
      );
      assert.equal(safeParseCustomerInsightOutput(result).success, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("googleGeminiCustomerInsightProvider empty content handling", () => {
  it("empty candidates array → provider_empty_content", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ candidates: [] }, { status: 200 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_empty_content");
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });

    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("missing content.parts → provider_empty_content", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json(
        { candidates: [{ content: { parts: [] }, finishReason: "STOP" }] },
        { status: 200 },
      ),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_empty_content");
    });
  });

  it("whitespace-only text → provider_empty_content", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json(
        {
          candidates: [
            { content: { parts: [{ text: "   " }], role: "model" }, finishReason: "STOP" },
          ],
        },
        { status: 200 },
      ),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_empty_content");
    });
  });

  it("finishReason=SAFETY with no text → provider_empty_content", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json(
        { candidates: [{ finishReason: "SAFETY" }] },
        { status: 200 },
      ),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_empty_content");
    });
  });
});

describe("googleGeminiCustomerInsightProvider error handling", () => {
  it("text exceeding response cap → provider_response_too_large without entering parser", async () => {
    const oversized = "x".repeat(20_001);
    const fetchMock = mock.fn(async () => makeSuccessResponse(oversized));

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_response_too_large");
      assert.equal(error.diagnostics?.contentLength, 20_001);
      const serialized = JSON.stringify(error.diagnostics);
      assert.equal(serialized.includes(oversized), false);
      assertNoSecrets(serialized);
    });

    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("malformed JSON → provider_json_parse_failed with no retry", async () => {
    const fetchMock = mock.fn(async () => makeSuccessResponse("{truncated by provider"));

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_json_parse_failed");
      assert.equal(error.diagnostics?.usedFallback, false);
      const serialized = JSON.stringify(error.diagnostics);
      assert.equal(serialized.includes("truncated"), false);
      assertNoSecrets(serialized);
    });

    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("HTTP 400 → provider_http_error with httpStatus=400", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "bad request" } }, { status: 400 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(error.diagnostics?.httpStatus, 400);
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });
  });

  it("HTTP 429 → provider_http_error with httpStatus=429", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "rate limit exceeded" } }, { status: 429 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(error.diagnostics?.httpStatus, 429);
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });
  });

  it("HTTP 503 → provider_http_error with httpStatus=503", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "service unavailable" } }, { status: 503 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(error.diagnostics?.httpStatus, 503);
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });
  });

  it("fetch reject → provider_request_failed", async () => {
    const fetchMock = mock.fn(async () => {
      throw new Error("network failure");
    });

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_request_failed");
      assert.equal(error.diagnostics?.httpStatus, undefined);
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });
  });

  it("fetch AbortError → provider_request_failed", async () => {
    const fetchMock = mock.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_request_failed");
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });
  });
});

describe("googleGeminiCustomerInsightProvider diagnostics safety", () => {
  it("diagnostics do not contain API key, prompt text, or response body", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "bad request" } }, { status: 400 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const serialized = JSON.stringify(error.diagnostics);
      assertNoSecrets(serialized);
    });
  });

  it("diagnostics include providerKind=google_gemini and correct requestUrlPath", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "bad request" } }, { status: 400 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const d = error.diagnostics;
      assert.equal(d?.providerKind, "google_gemini");
      assert.equal(d?.requestUrlHost, "generativelanguage.googleapis.com");
      assert.equal(d?.requestUrlPath, "/v1beta/models/gemini-3.5-flash:generateContent");
    });
  });

  it("error diagnostics include durationMs, contextLength, promptLength, usedFallback=false", async () => {
    const fetchMock = mock.fn(async () => makeSuccessResponse("{not valid json}"));

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const d = error.diagnostics;
      assert.equal(d?.providerErrorType, "provider_json_parse_failed");
      assert.equal(typeof d?.durationMs, "number");
      assert.ok((d?.durationMs ?? -1) >= 0);
      assert.equal(typeof d?.contextLength, "number");
      assert.ok((d?.contextLength ?? -1) > 0);
      assert.equal(typeof d?.promptLength, "number");
      assert.ok((d?.promptLength ?? -1) > 0);
      assert.equal(d?.usedFallback, false);
    });
  });
});

describe("CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA integrity", () => {
  it("native schema required fields match customerInsightOutputSchema keys", () => {
    const zodKeys = Object.keys(customerInsightOutputSchema.shape).sort();
    const nativeRequired = [...CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA.required].sort();
    assert.deepEqual(nativeRequired, zodKeys);
  });

  it("native schema properties keys match customerInsightOutputSchema keys", () => {
    const zodKeys = Object.keys(customerInsightOutputSchema.shape).sort();
    const nativePropertyKeys = Object.keys(CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA.properties).sort();
    assert.deepEqual(nativePropertyKeys, zodKeys);
  });

  it("native schema and openai-compat schema share same required fields", () => {
    const nativeRequired = [...CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA.required].sort();
    const compatRequired = [...CUSTOMER_INSIGHT_JSON_SCHEMA.required].sort();
    assert.deepEqual(nativeRequired, compatRequired);
  });

  it("native schema uses nullable:true for suggestedFollowUpAt, not type array", () => {
    const prop = CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA.properties.suggestedFollowUpAt;
    assert.equal((prop as Record<string, unknown>).nullable, true);
    assert.equal(Array.isArray(prop.type), false);
  });
});

describe("factory routing for google_gemini", () => {
  it("getCustomerInsightProviderImpl returns googleGeminiCustomerInsightProvider for google_gemini", () => {
    const resolved: ResolvedCustomerInsightProvider = {
      kind: "google_gemini",
      model: "gemini-3.5-flash",
      config: {
        apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-3.5-flash",
        temperature: 0.2,
        maxTokens: 1200,
        timeoutMs: 30_000,
        apiKey: "test-key",
      },
    };
    const impl = getCustomerInsightProviderImpl(resolved);
    assert.equal(impl, googleGeminiCustomerInsightProvider);
  });

  it("getCustomerInsightProviderImpl still returns openAiCompatibleCustomerInsightProvider for openai_compatible", () => {
    const resolved: ResolvedCustomerInsightProvider = {
      kind: "openai_compatible",
      model: "gemini-3.5-flash",
      config: {
        apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        model: "gemini-3.5-flash",
        temperature: 0.2,
        maxTokens: 1200,
        timeoutMs: 30_000,
        apiKey: "test-key",
      },
    };
    const impl = getCustomerInsightProviderImpl(resolved);
    assert.equal(impl, openAiCompatibleCustomerInsightProvider);
  });

  it("getCustomerInsightProviderImpl returns mockCustomerInsightProvider for mock", () => {
    const resolved: ResolvedCustomerInsightProvider = {
      kind: "mock",
      model: "mock-customer-insight-v1",
      config: null,
    };
    const impl = getCustomerInsightProviderImpl(resolved);
    assert.equal(impl, mockCustomerInsightProvider);
  });

  it("resolveCustomerInsightProvider returns mock when ai_enabled=false", () => {
    const mockSettings = {
      aiEnabled: false,
      aiProvider: "google_gemini",
      aiApiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      aiApiBaseUrlValid: true,
      aiModel: "gemini-3.5-flash",
      aiTemperature: 0.2,
      aiMaxTokens: 1200,
      aiTimeoutMs: 30_000,
    } as EffectiveAiSettings;

    const resolved = resolveCustomerInsightProvider(mockSettings);
    assert.equal(resolved.kind, "mock");
    assert.equal(resolved.config, null);
  });

  it("resolveCustomerInsightProvider returns google_gemini kind when ai_enabled=true", () => {
    const originalKey = process.env.AI_API_KEY;
    process.env.AI_API_KEY = "test-key-for-factory";

    try {
      const geminiSettings = {
        aiEnabled: true,
        aiProvider: "google_gemini",
        aiApiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        aiApiBaseUrlValid: true,
        aiModel: "gemini-3.5-flash",
        aiTemperature: 0.2,
        aiMaxTokens: 1200,
        aiTimeoutMs: 30_000,
      } as EffectiveAiSettings;

      const resolved = resolveCustomerInsightProvider(geminiSettings);
      assert.equal(resolved.kind, "google_gemini");
      assert.equal(resolved.config?.apiBaseUrl, "https://generativelanguage.googleapis.com/v1beta");
    } finally {
      if (originalKey === undefined) {
        delete process.env.AI_API_KEY;
      } else {
        process.env.AI_API_KEY = originalKey;
      }
    }
  });
});
