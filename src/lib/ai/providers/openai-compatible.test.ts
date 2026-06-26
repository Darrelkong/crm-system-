import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { AiProviderError } from "@/lib/ai/customer-insights/errors";
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

function assertNoSecrets(serialized: string): void {
  assert.equal(serialized.includes(SECRET_API_KEY), false);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("Authorization"), false);
  assert.equal(serialized.includes(SENSITIVE_CUSTOMER_NAME), false);
  assert.equal(serialized.includes("13800138000"), false);
  assert.equal(serialized.includes("sensitive@example.com"), false);
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

describe("openAiCompatibleCustomerInsightProvider diagnostics", () => {
  it("records httpStatus for provider HTTP errors without leaking secrets", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ error: { message: "invalid api key" } }, { status: 401 }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

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
          const diagnostics = (error as AiProviderError).diagnostics;
          assert.equal(diagnostics?.providerErrorType, "provider_http_error");
          assert.equal(diagnostics?.httpStatus, 401);
          assert.equal(diagnostics?.requestUrlPath, "/v1beta/openai/chat/completions");
          assertNoSecrets(JSON.stringify(diagnostics));
          return true;
        },
      );
      assert.equal(fetchMock.mock.calls.length >= 1, true);
      const callArgs = fetchMock.mock.calls[0]?.arguments as unknown as
        | [RequestInfo | URL, RequestInit?]
        | undefined;
      const requestInit = callArgs?.[1];
      assert.equal(typeof requestInit?.headers, "object");
      const headers = requestInit?.headers as Record<string, string>;
      assert.equal(headers.Authorization, `Bearer ${SECRET_API_KEY}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("records provider_empty_content without leaking prompt or API key", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({ choices: [{ message: { content: "   " } }] }, { status: 200 }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

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
          const diagnostics = (error as AiProviderError).diagnostics;
          assert.equal(diagnostics?.providerErrorType, "provider_empty_content");
          assert.equal(diagnostics?.httpStatus, undefined);
          assertNoSecrets(JSON.stringify(diagnostics));
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("records provider_json_parse_failed without leaking response body", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json(
        { choices: [{ message: { content: "not valid json" } }] },
        { status: 200 },
      ),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

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
          const diagnostics = (error as AiProviderError).diagnostics;
          assert.equal(diagnostics?.providerErrorType, "provider_json_parse_failed");
          const serialized = JSON.stringify(diagnostics);
          assert.equal(serialized.includes("not valid json"), false);
          assertNoSecrets(serialized);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
