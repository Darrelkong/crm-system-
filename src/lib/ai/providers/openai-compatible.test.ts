import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import { safeParseCustomerInsightOutput } from "@/lib/ai/customer-insights/schema";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import {
  buildChatCompletionsUrl,
  openAiCompatibleCustomerInsightProvider,
} from "./openai-compatible";

const SECRET_API_KEY = "sk-gemini-secret-key-do-not-log";
const SENSITIVE_CUSTOMER_NAME = "张三敏感客户";

const runtimeConfig = {
  apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
  model: "gemini-3.5-flash",
  temperature: 0.2,
  maxTokens: 1024,
  timeoutMs: 30_000,
  apiKey: SECRET_API_KEY,
};

const settings = {
  aiAnalysisLanguage: "zh-Hans",
  aiPromptTemplate: "分析客户：{{customerName}} 电话 {{phone}}",
} as EffectiveAiSettings;

const context = {
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
  updatedAt: "2026-06-26T00:00:00.000Z",
  includeSensitiveFields: true,
  phone: "13800138000",
  wechatId: null,
  email: "sensitive@example.com",
  recentFollowUps: [],
} satisfies CustomerInsightContext;

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
        openAiCompatibleCustomerInsightProvider.analyzeCustomerInsight(
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

async function analyzeContent(content: string): Promise<unknown> {
  const fetchMock = mock.fn(async () =>
    Response.json({ choices: [{ message: { content } }] }, { status: 200 }),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as typeof fetch;

  try {
    const result = await openAiCompatibleCustomerInsightProvider.analyzeCustomerInsight(
      context,
      settings,
      runtimeConfig,
    );
    assert.equal(fetchMock.mock.calls.length, 1);
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("buildChatCompletionsUrl", () => {
  it("appends /v1/chat/completions for OpenAI official base URL", () => {
    assert.equal(
      buildChatCompletionsUrl("https://api.openai.com"),
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("strips trailing slash for OpenAI official base URL", () => {
    assert.equal(
      buildChatCompletionsUrl("https://api.openai.com/"),
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("appends /chat/completions for Gemini OpenAI-compatible base URL", () => {
    assert.equal(
      buildChatCompletionsUrl("https://generativelanguage.googleapis.com/v1beta/openai"),
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
  });

  it("strips trailing slash for Gemini OpenAI-compatible base URL", () => {
    assert.equal(
      buildChatCompletionsUrl("https://generativelanguage.googleapis.com/v1beta/openai/"),
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
  });
});

describe("openAiCompatibleCustomerInsightProvider JSON parsing", () => {
  it("parses raw JSON content", async () => {
    const result = await analyzeContent(JSON.stringify(validInsightPayload));
    assert.deepEqual(result, validInsightPayload);
  });

  it("parses content fully wrapped in fenced JSON", async () => {
    const result = await analyzeContent(
      `\`\`\`json\n${JSON.stringify(validInsightPayload)}\n\`\`\``,
    );
    assert.deepEqual(result, validInsightPayload);
  });

  it("parses fenced JSON after provider explanation text", async () => {
    const result = await analyzeContent(
      `Here is the JSON:\n\`\`\`json\n${JSON.stringify(validInsightPayload)}\n\`\`\``,
    );
    assert.deepEqual(result, validInsightPayload);
  });

  it("parses fenced JSON before trailing provider text", async () => {
    const result = await analyzeContent(
      `\`\`\`\n${JSON.stringify(validInsightPayload)}\n\`\`\`\nHope this helps.`,
    );
    assert.deepEqual(result, validInsightPayload);
  });

  it("parses a JSON object embedded between normal text", async () => {
    const result = await analyzeContent(
      `Analysis result follows:\n${JSON.stringify(validInsightPayload)}\nEnd.`,
    );
    assert.deepEqual(result, validInsightPayload);
  });

  it("handles braces inside JSON string fields while extracting embedded object", async () => {
    const payload = {
      ...validInsightPayload,
      reasoning: 'The text contains {braces}, } characters, and an escaped " quote.',
    };
    const result = await analyzeContent(
      `Gemini response:\n${JSON.stringify(payload)}\nDone.`,
    );
    assert.deepEqual(result, payload);
  });

  it("keeps truncated JSON as provider_json_parse_failed without leaking content", async () => {
    const truncated = `Leading text ${JSON.stringify(validInsightPayload).slice(0, 40)}`;
    const fetchMock = mock.fn(async () =>
      Response.json(
        { choices: [{ message: { content: truncated } }] },
        { status: 200 },
      ),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const diagnostics = error.diagnostics;
      assert.equal(diagnostics?.providerErrorType, "provider_json_parse_failed");
      assert.equal(diagnostics?.contentLength, truncated.length);
      assert.equal(diagnostics?.parseStrategy, "none");
      assert.equal(diagnostics?.firstNonWhitespaceChar, "L");
      const serialized = JSON.stringify(diagnostics);
      assert.equal(serialized.includes(truncated), false);
      assert.equal(serialized.includes("Leading text"), false);
      assertNoSecrets(serialized);
    });
  });

  it("does not treat schema validation failure as JSON parse failure", async () => {
    const invalidSchemaPayload = {
      ...validInsightPayload,
      intentLevel: "definitely-not-valid",
    };
    const result = await analyzeContent(JSON.stringify(invalidSchemaPayload));
    assert.deepEqual(result, invalidSchemaPayload);
    assert.equal(safeParseCustomerInsightOutput(result).success, false);
  });
});

describe("openAiCompatibleCustomerInsightProvider diagnostics", () => {
  it("records httpStatus for provider HTTP errors without leaking secrets", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "invalid api key" } }, { status: 401 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const diagnostics = error.diagnostics;
      assert.equal(diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(diagnostics?.httpStatus, 401);
      assert.equal(diagnostics?.requestUrlPath, "/v1beta/openai/chat/completions");
      assertNoSecrets(JSON.stringify(diagnostics));
    });

    assert.equal(fetchMock.mock.calls.length >= 1, true);
    const callArgs = fetchMock.mock.calls[0]?.arguments as unknown as
      | [RequestInfo | URL, RequestInit?]
      | undefined;
    const requestInit = callArgs?.[1];
    assert.equal(typeof requestInit?.headers, "object");
    const headers = requestInit?.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${SECRET_API_KEY}`);
  });

  it("records provider_http_error with httpStatus 503 without leaking secrets", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "service unavailable" } }, { status: 503 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const diagnostics = error.diagnostics;
      assert.equal(diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(diagnostics?.httpStatus, 503);
      assertNoSecrets(JSON.stringify(diagnostics));
    });
  });

  it("records provider_http_error with httpStatus 429 without leaking secrets", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "rate limit exceeded" } }, { status: 429 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const diagnostics = error.diagnostics;
      assert.equal(diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(diagnostics?.httpStatus, 429);
      assertNoSecrets(JSON.stringify(diagnostics));
    });
  });

  it("records provider_request_failed when fetch rejects", async () => {
    const fetchMock = mock.fn(async () => {
      throw new Error("network failure");
    });

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const diagnostics = error.diagnostics;
      assert.equal(diagnostics?.providerErrorType, "provider_request_failed");
      assert.equal(diagnostics?.httpStatus, undefined);
      assertNoSecrets(JSON.stringify(diagnostics));
    });
  });

  it("records provider_request_failed when fetch throws AbortError", async () => {
    const fetchMock = mock.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const diagnostics = error.diagnostics;
      assert.equal(diagnostics?.providerErrorType, "provider_request_failed");
      assert.equal(diagnostics?.httpStatus, undefined);
      assertNoSecrets(JSON.stringify(diagnostics));
    });
  });

  it("records provider_empty_content when content is whitespace only", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ choices: [{ message: { content: "   " } }] }, { status: 200 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const diagnostics = error.diagnostics;
      assert.equal(diagnostics?.providerErrorType, "provider_empty_content");
      assert.equal(diagnostics?.httpStatus, undefined);
      assertNoSecrets(JSON.stringify(diagnostics));
    });
  });

  it("records provider_empty_content when choices array is empty", async () => {
    const fetchMock = mock.fn(async () => Response.json({ choices: [] }, { status: 200 }));

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const diagnostics = error.diagnostics;
      assert.equal(diagnostics?.providerErrorType, "provider_empty_content");
      assertNoSecrets(JSON.stringify(diagnostics));
    });
  });

  it("records provider_json_parse_failed without leaking response body", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json(
        { choices: [{ message: { content: "not valid json" } }] },
        { status: 200 },
      ),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const diagnostics = error.diagnostics;
      assert.equal(diagnostics?.providerErrorType, "provider_json_parse_failed");
      const serialized = JSON.stringify(diagnostics);
      assert.equal(serialized.includes("not valid json"), false);
      assertNoSecrets(serialized);
    });
  });

  it("retries without response_format when first request fails and second succeeds", async () => {
    let callIndex = 0;
    const fetchMock = mock.fn(async (_url, init) => {
      callIndex += 1;
      const body = parseRequestBody(init);

      if (callIndex === 1) {
        assert.deepEqual(body.response_format, { type: "json_object" });
        return Response.json({ error: { message: "unsupported response_format" } }, { status: 400 });
      }

      assert.equal("response_format" in body, false);
      return Response.json(
        {
          choices: [{ message: { content: JSON.stringify(validInsightPayload) } }],
        },
        { status: 200 },
      );
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const result = await openAiCompatibleCustomerInsightProvider.analyzeCustomerInsight(
        context,
        settings,
        runtimeConfig,
      );
      assert.deepEqual(result, validInsightPayload);
      assert.equal(fetchMock.mock.calls.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns safe error when response_format fallback second attempt also fails", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "service unavailable" } }, { status: 503 }),
    );

    await expectProviderError(fetchMock as typeof fetch, (error) => {
      const diagnostics = error.diagnostics;
      assert.equal(diagnostics?.providerErrorType, "provider_http_error");
      assert.equal(diagnostics?.httpStatus, 503);
      assertNoSecrets(JSON.stringify(diagnostics));
      assertNoSecrets(JSON.stringify(error));
    });

    assert.equal(fetchMock.mock.calls.length, 2);
    const firstCallArgs = fetchMock.mock.calls[0]?.arguments as unknown as
      | [RequestInfo | URL, RequestInit?]
      | undefined;
    const secondCallArgs = fetchMock.mock.calls[1]?.arguments as unknown as
      | [RequestInfo | URL, RequestInit?]
      | undefined;
    const firstBody = parseRequestBody(firstCallArgs?.[1]);
    const secondBody = parseRequestBody(secondCallArgs?.[1]);
    assert.deepEqual(firstBody.response_format, { type: "json_object" });
    assert.equal("response_format" in secondBody, false);
  });
});
