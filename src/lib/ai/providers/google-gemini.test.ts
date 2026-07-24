import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import {
  CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA,
  CUSTOMER_INSIGHT_JSON_SCHEMA,
} from "@/lib/ai/customer-insights/json-schema";
import { CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA } from "@/lib/ai/phase2/gemini-phase2-flat-schema";
import { GEMINI_PHASE2_FLAT_CONTRACT_VERSION } from "@/lib/ai/phase2/gemini-phase2-flat-contract";
import { findGeminiUnsupportedSchemaPaths } from "@/lib/ai/phase2/provider-json-schema";
import { customerInsightOutputSchema, safeParseCustomerInsightOutput } from "@/lib/ai/customer-insights/schema";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import {
  buildGeminiGenerateUrl,
  googleGeminiCustomerInsightProvider,
  resetGeminiRetrySleepMsForTests,
  setGeminiRetrySleepMsForTests,
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
      assert.deepEqual(gc.responseSchema, CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA);
      const schemaProps = (gc.responseSchema as { properties?: Record<string, unknown> })
        .properties;
      assert.ok(schemaProps);
      assert.equal("phase2Signals" in schemaProps, false);
      assert.equal("phase2SignalRows" in schemaProps, true);
      assert.deepEqual(
        findGeminiUnsupportedSchemaPaths(gc.responseSchema),
        [],
      );    } finally {
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
      assert.doesNotMatch(si.parts[0].text, /phase2Signals/);
      assert.match(si.parts[0].text, /phase2SignalRows/);
      assert.match(si.parts[0].text, new RegExp(GEMINI_PHASE2_FLAT_CONTRACT_VERSION));    } finally {
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
      Response.json(
        {
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message:
              'Invalid JSON payload received. Unknown name "nullable" at \'generation_config.response_schema.properties.phase2Signals\'',
          },
        },
        { status: 400 },
      ),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(error.diagnostics?.httpStatus, 400);
      assert.equal(error.diagnostics?.failureStage, "provider_http");
      assert.equal(error.diagnostics?.geminiApiStatus, "INVALID_ARGUMENT");
      assert.equal(error.diagnostics?.geminiErrorCode, 400);
      assert.ok(error.diagnostics?.schemaKeywordHint?.includes("nullable"));
      assert.match(
        error.diagnostics?.schemaPathHint ?? "",
        /response_schema\.properties\.phase2Signals/i,
      );
      assertNoSecrets(JSON.stringify(error.diagnostics));
      // Full Gemini message must not be stored; only allowlisted keyword tokens.
      assert.equal(
        JSON.stringify(error.diagnostics).includes(
          "Invalid JSON payload received. Unknown name",
        ),
        false,
      );
    });

    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("HTTP 401 → provider_http_error with httpStatus=401 without retry", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "unauthorized" } }, { status: 401 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(error.diagnostics?.httpStatus, 401);
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });

    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("HTTP 403 → provider_http_error with httpStatus=403 without retry", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "forbidden" } }, { status: 403 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(error.diagnostics?.httpStatus, 403);
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });

    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("HTTP 404 → provider_http_error with httpStatus=404 without retry", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "not found" } }, { status: 404 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(error.diagnostics?.httpStatus, 404);
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });

    assert.equal(fetchMock.mock.calls.length, 1);
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

    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("HTTP 503 → provider_http_error with httpStatus=503 after exhausting retries", async () => {
    setGeminiRetrySleepMsForTests(async () => {});
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "service unavailable" } }, { status: 503 }),
    );

    try {
      await expectProviderError(fetchMock as typeof fetch, (error) => {
        assert.equal(error.diagnostics?.providerErrorType, "provider_http_error");
        assert.equal(error.diagnostics?.httpStatus, 503);
        assertNoSecrets(JSON.stringify(error.diagnostics));
      });
    } finally {
      resetGeminiRetrySleepMsForTests();
    }

    assert.equal(fetchMock.mock.calls.length, 3);
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

    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("fetch AbortError → provider_request_failed", async () => {
    const fetchMock = mock.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_request_failed");
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });

    assert.equal(fetchMock.mock.calls.length, 1);
  });
});

describe("googleGeminiCustomerInsightProvider transient HTTP retry", () => {
  const zeroDelaySleep = mock.fn(async (_ms: number) => {});

  function resetRetryTestMocks(): void {
    zeroDelaySleep.mock.resetCalls();
  }

  async function runWithFetch(
    fetchImpl: typeof fetch,
    run: () => Promise<void>,
  ): Promise<void> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    setGeminiRetrySleepMsForTests(zeroDelaySleep);

    try {
      await run();
    } finally {
      globalThis.fetch = originalFetch;
      resetGeminiRetrySleepMsForTests();
    }
  }

  async function runSuccessWithFetch(fetchImpl: typeof fetch): Promise<unknown> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    setGeminiRetrySleepMsForTests(zeroDelaySleep);

    try {
      return await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(
        context,
        settings,
        runtimeConfig,
      );
    } finally {
      globalThis.fetch = originalFetch;
      resetGeminiRetrySleepMsForTests();
    }
  }

  it("503 then success → succeeds on second attempt", async () => {
    resetRetryTestMocks();
    let callCount = 0;
    const fetchMock = mock.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return Response.json({ error: { message: "service unavailable" } }, { status: 503 });
      }
      return makeSuccessResponse(JSON.stringify(validInsightPayload));
    });

    const result = await runSuccessWithFetch(fetchMock as typeof fetch);
    assert.deepEqual(result, validInsightPayload);
    assert.equal(fetchMock.mock.calls.length, 2);
    assert.equal(zeroDelaySleep.mock.calls.length, 1);
    assert.equal(zeroDelaySleep.mock.calls[0]?.arguments[0], 500);
  });

  for (const status of [502, 503, 504] as const) {
    it(`HTTP ${status} is retried up to max attempts`, async () => {
      resetRetryTestMocks();
      const fetchMock = mock.fn(async () =>
        Response.json({ error: { message: "transient" } }, { status }),
      );

      await runWithFetch(fetchMock as typeof fetch, async () => {
        await expectProviderError(fetchMock as typeof fetch, (error) => {
          assert.equal(error.diagnostics?.providerErrorType, "provider_http_error");
          assert.equal(error.diagnostics?.httpStatus, status);
        });
      });

      assert.equal(fetchMock.mock.calls.length, 3);
      assert.equal(zeroDelaySleep.mock.calls.length, 2);
      assert.deepEqual(
        zeroDelaySleep.mock.calls.map((call) => call.arguments[0]),
        [500, 1500],
      );
    });
  }

  it("503 consecutive failures → final AiProviderError with httpStatus=503", async () => {
    resetRetryTestMocks();
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "service unavailable" } }, { status: 503 }),
    );

    await runWithFetch(fetchMock as typeof fetch, async () => {
      await expectProviderError(fetchMock as typeof fetch, (error) => {
        assert.equal(error.diagnostics?.providerErrorType, "provider_http_error");
        assert.equal(error.diagnostics?.httpStatus, 503);
        assertNoSecrets(JSON.stringify(error.diagnostics));
      });
    });

    assert.equal(fetchMock.mock.calls.length, 3);
  });

  for (const status of [400, 401, 403, 404, 429] as const) {
    it(`HTTP ${status} is not retried`, async () => {
      resetRetryTestMocks();
      const fetchMock = mock.fn(async () =>
        Response.json({ error: { message: "error" } }, { status }),
      );

      await runWithFetch(fetchMock as typeof fetch, async () => {
        await expectProviderError(fetchMock as typeof fetch, (error) => {
          assert.equal(error.diagnostics?.httpStatus, status);
        });
      });

      assert.equal(fetchMock.mock.calls.length, 1);
      assert.equal(zeroDelaySleep.mock.calls.length, 0);
    });
  }

  it("timeout / AbortError is not retried", async () => {
    resetRetryTestMocks();
    const fetchMock = mock.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await runWithFetch(fetchMock as typeof fetch, async () => {
      await expectProviderError(fetchMock as typeof fetch, (error) => {
        assert.equal(error.diagnostics?.providerErrorType, "provider_request_failed");
      });
    });

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(zeroDelaySleep.mock.calls.length, 0);
  });

  it("network reject is not retried", async () => {
    resetRetryTestMocks();
    const fetchMock = mock.fn(async () => {
      throw new Error("network failure");
    });

    await runWithFetch(fetchMock as typeof fetch, async () => {
      await expectProviderError(fetchMock as typeof fetch, (error) => {
        assert.equal(error.diagnostics?.providerErrorType, "provider_request_failed");
      });
    });

    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("retries reuse the same request body, model URL, and endpoint", async () => {
    resetRetryTestMocks();
    let callCount = 0;
    const fetchMock = mock.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      if (callCount < 3) {
        return Response.json({ error: { message: "unavailable" } }, { status: 503 });
      }
      return makeSuccessResponse(JSON.stringify(validInsightPayload));
    });

    await runSuccessWithFetch(fetchMock as typeof fetch);

    assert.equal(fetchMock.mock.calls.length, 3);
    const firstUrl = fetchMock.mock.calls[0]?.arguments[0];
    const firstBody = fetchMock.mock.calls[0]?.arguments[1]?.body;
    for (const call of fetchMock.mock.calls) {
      assert.equal(call.arguments[0], firstUrl);
      assert.equal(call.arguments[1]?.body, firstBody);
      assert.equal(String(call.arguments[1]?.body).includes(SECRET_API_KEY), false);
    }
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

  it("native schema properties keys match base customerInsightOutputSchema keys only", () => {
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

  it("native schema has no Gemini-unsupported keywords (anyOf / type unions / additionalProperties)", () => {
    const unsupported = findGeminiUnsupportedSchemaPaths(
      CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA,
    );
    assert.deepEqual(
      unsupported,
      [],
      `Gemini-unsupported paths: ${unsupported.join(", ")}`,
    );
  });

  it("native Gemini Base-12 schema constant still excludes phase2Signals (reference)", () => {
    assert.equal(
      "phase2Signals" in CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA.properties,
      false,
    );
    assert.equal(
      "phase2SignalRows" in CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA.properties,
      false,
    );
    assert.ok("phase2Signals" in CUSTOMER_INSIGHT_JSON_SCHEMA.properties);
  });

  it("local Gemini runtime Flat schema includes required phase2SignalRows", () => {
    assert.ok(
      "phase2SignalRows" in
        CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA.properties,
    );
    assert.ok(
      CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA.required.includes(
        "phase2SignalRows",
      ),
    );
    assert.equal(
      "phase2Signals" in
        CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA.properties,
      false,
    );
  });
});

describe("googleGeminiCustomerInsightProvider multi-part response merging", () => {
  function makeMultiPartResponse(parts: Array<{ text?: string }>): Response {
    return Response.json(
      {
        candidates: [
          {
            content: { parts, role: "model" },
            finishReason: "STOP",
          },
        ],
      },
      { status: 200 },
    );
  }

  it("single text part valid JSON → success (baseline)", async () => {
    const fetchMock = mock.fn(async () =>
      makeSuccessResponse(JSON.stringify(validInsightPayload)),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const result = await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(
        context,
        settings,
        runtimeConfig,
      );
      assert.deepEqual(result, validInsightPayload);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("multiple text parts joined produce valid JSON → success", async () => {
    const json = JSON.stringify(validInsightPayload);
    // Split into three roughly-equal chunks so no single chunk is valid JSON.
    const a = Math.floor(json.length / 3);
    const b = Math.floor((json.length * 2) / 3);
    const fetchMock = mock.fn(async () =>
      makeMultiPartResponse([
        { text: json.slice(0, a) },
        { text: json.slice(a, b) },
        { text: json.slice(b) },
      ]),
    );
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

  it("first part alone is invalid JSON but concatenation of two parts is valid → success", async () => {
    const json = JSON.stringify(validInsightPayload);
    const splitAt = Math.floor(json.length / 2);
    // Confirm the first half is indeed not valid JSON on its own.
    let firstHalfIsInvalid = false;
    try {
      JSON.parse(json.slice(0, splitAt));
    } catch {
      firstHalfIsInvalid = true;
    }
    assert.ok(firstHalfIsInvalid, "test pre-condition: first half must be invalid JSON");

    const fetchMock = mock.fn(async () =>
      makeMultiPartResponse([
        { text: json.slice(0, splitAt) },
        { text: json.slice(splitAt) },
      ]),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const result = await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(
        context,
        settings,
        runtimeConfig,
      );
      assert.deepEqual(result, validInsightPayload);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parts with no text field (e.g. inlineData only) → provider_empty_content", async () => {
    const fetchMock = mock.fn(async () =>
      makeMultiPartResponse([
        { text: undefined } as unknown as { text?: string },
      ]),
    );
    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_empty_content");
      assert.equal(error.diagnostics?.partsCount, 1);
      assert.equal(error.diagnostics?.textPartsCount, 0);
      assert.equal(error.diagnostics?.combinedTextLength, 0);
    });
  });

  it("text parts all whitespace across multiple parts → provider_empty_content", async () => {
    const fetchMock = mock.fn(async () =>
      makeMultiPartResponse([{ text: "  " }, { text: "   " }, { text: " " }]),
    );
    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_empty_content");
      assert.equal(error.diagnostics?.textPartsCount, 3);
      assert.equal(error.diagnostics?.combinedTextLength, 0);
    });
  });

  it("combined text from multiple parts exceeds response cap → provider_response_too_large", async () => {
    // Build an oversized string split across two parts so neither alone triggers the cap.
    const half = "x".repeat(10_001);
    const fetchMock = mock.fn(async () =>
      makeMultiPartResponse([{ text: half }, { text: half }]),
    );
    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_response_too_large");
      assert.ok((error.diagnostics?.contentLength ?? 0) > 20_000);
    });
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("combined text from multiple parts is malformed JSON → provider_json_parse_failed", async () => {
    // Two parts that together form invalid JSON (no closing brace overall).
    const fetchMock = mock.fn(async () =>
      makeMultiPartResponse([{ text: '{"key": "val' }, { text: "ue without closing" }]),
    );
    await expectProviderError(fetchMock as typeof fetch, (error) => {
      assert.equal(error.diagnostics?.providerErrorType, "provider_json_parse_failed");
      assert.equal(error.diagnostics?.usedFallback, false);
      assert.equal(error.diagnostics?.partsCount, 2);
      assert.equal(error.diagnostics?.textPartsCount, 2);
      assertNoSecrets(JSON.stringify(error.diagnostics));
    });
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it("parse failure diagnostics include candidateCount, partsCount, textPartsCount, firstTextPartLength, combinedTextLength, finishReason", async () => {
    const fetchMock = mock.fn(async () =>
      makeSuccessResponse("{malformed json no closing brace"),
    );
    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const d = error.diagnostics;
      assert.equal(d?.providerErrorType, "provider_json_parse_failed");
      assert.equal(d?.candidateCount, 1);
      assert.equal(d?.partsCount, 1);
      assert.equal(d?.textPartsCount, 1);
      assert.equal(typeof d?.firstTextPartLength, "number");
      assert.ok((d?.firstTextPartLength ?? -1) > 0);
      assert.equal(typeof d?.combinedTextLength, "number");
      assert.ok((d?.combinedTextLength ?? -1) > 0);
      assert.equal(d?.finishReason, "STOP");
      // Ensure raw content is not exposed.
      const serialized = JSON.stringify(d);
      assert.equal(serialized.includes("malformed"), false);
      assertNoSecrets(serialized);
    });
  });

  it("empty_content diagnostics include response structure fields (partsCount, textPartsCount)", async () => {
    const fetchMock = mock.fn(async () =>
      makeMultiPartResponse([{ text: "  " }, { text: "\n" }]),
    );
    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const d = error.diagnostics;
      assert.equal(d?.providerErrorType, "provider_empty_content");
      assert.equal(d?.candidateCount, 1);
      assert.equal(d?.partsCount, 2);
      assert.equal(d?.textPartsCount, 2);
      assert.equal(d?.combinedTextLength, 0);
      assert.equal(d?.finishReason, "STOP");
      assertNoSecrets(JSON.stringify(d));
    });
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
