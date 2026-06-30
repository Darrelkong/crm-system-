import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAiInsightRefreshFailedAuditMetadata,
  buildProviderDiagnostics,
  toSafeFailureAuditMetadata,
  type AiProviderDiagnostics,
} from "./diagnostics";
import { AiAnalysisError } from "./errors";

const SECRET_API_KEY = "sk-gemini-secret-key-do-not-log";
const SENSITIVE_PROMPT = "客户姓名：张三 电话：13800138000 email@test.com";
const SENSITIVE_PHONE = "13800138000";
const SENSITIVE_EMAIL = "sensitive@example.com";
const SENSITIVE_WECHAT = "wx_sensitive_user";
const PROVIDER_RAW_BODY = "upstream raw error body with secrets";

const providerConfig = {
  apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
  model: "gemini-3.5-flash",
};

function assertMetadataWhitelist(
  metadata: Record<string, string | number>,
  expected: Record<string, string | number>,
): void {
  assert.deepEqual(metadata, expected);

  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes(SECRET_API_KEY), false);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("Authorization"), false);
  assert.equal(serialized.includes(SENSITIVE_PROMPT), false);
  assert.equal(serialized.includes(SENSITIVE_PHONE), false);
  assert.equal(serialized.includes(SENSITIVE_EMAIL), false);
  assert.equal(serialized.includes(SENSITIVE_WECHAT), false);
  assert.equal(serialized.includes(PROVIDER_RAW_BODY), false);
}

describe("AI insight failure diagnostics", () => {
  it("toSafeFailureAuditMetadata only exposes allowed troubleshooting fields", () => {
    const diagnostics = buildProviderDiagnostics(
      providerConfig,
      "openai_compatible",
      "provider_http_error",
      401,
    );

    const metadata = toSafeFailureAuditMetadata({
      ...diagnostics,
      apiKey: SECRET_API_KEY,
      authorization: `Bearer ${SECRET_API_KEY}`,
      prompt: SENSITIVE_PROMPT,
      responseBody: PROVIDER_RAW_BODY,
      phone: SENSITIVE_PHONE,
      email: SENSITIVE_EMAIL,
      wechatId: SENSITIVE_WECHAT,
    } as AiProviderDiagnostics);

    assertMetadataWhitelist(metadata, {
      providerKind: "openai_compatible",
      model: "gemini-3.5-flash",
      providerErrorType: "provider_http_error",
      httpStatus: 401,
      requestUrlHost: "generativelanguage.googleapis.com",
      requestUrlPath: "/v1beta/openai/chat/completions",
    });
  });

  it("503 diagnostics metadata includes required troubleshooting fields only", () => {
    const diagnostics = buildProviderDiagnostics(
      providerConfig,
      "openai_compatible",
      "provider_http_error",
      503,
    );

    const metadata = toSafeFailureAuditMetadata({
      ...diagnostics,
      apiKey: SECRET_API_KEY,
      prompt: SENSITIVE_PROMPT,
      responseBody: PROVIDER_RAW_BODY,
    } as AiProviderDiagnostics);

    assertMetadataWhitelist(metadata, {
      providerKind: "openai_compatible",
      model: "gemini-3.5-flash",
      providerErrorType: "provider_http_error",
      httpStatus: 503,
      requestUrlHost: "generativelanguage.googleapis.com",
      requestUrlPath: "/v1beta/openai/chat/completions",
    });
  });

  it("429 diagnostics metadata follows the same whitelist", () => {
    const diagnostics = buildProviderDiagnostics(
      providerConfig,
      "openai_compatible",
      "provider_http_error",
      429,
    );

    const metadata = toSafeFailureAuditMetadata({
      ...diagnostics,
      authorization: `Bearer ${SECRET_API_KEY}`,
      prompt: SENSITIVE_PROMPT,
      phone: SENSITIVE_PHONE,
    } as AiProviderDiagnostics);

    assertMetadataWhitelist(metadata, {
      providerKind: "openai_compatible",
      model: "gemini-3.5-flash",
      providerErrorType: "provider_http_error",
      httpStatus: 429,
      requestUrlHost: "generativelanguage.googleapis.com",
      requestUrlPath: "/v1beta/openai/chat/completions",
    });
  });

  it("timeout diagnostics metadata follows the same whitelist", () => {
    const diagnostics = buildProviderDiagnostics(
      providerConfig,
      "openai_compatible",
      "provider_request_failed",
    );

    const metadata = toSafeFailureAuditMetadata({
      ...diagnostics,
      apiKey: SECRET_API_KEY,
      prompt: SENSITIVE_PROMPT,
      email: SENSITIVE_EMAIL,
      wechatId: SENSITIVE_WECHAT,
    } as AiProviderDiagnostics);

    assertMetadataWhitelist(metadata, {
      providerKind: "openai_compatible",
      model: "gemini-3.5-flash",
      providerErrorType: "provider_request_failed",
      requestUrlHost: "generativelanguage.googleapis.com",
      requestUrlPath: "/v1beta/openai/chat/completions",
    });
  });

  it("buildAiInsightRefreshFailedAuditMetadata merges errorCode with safe diagnostics", () => {
    const error = new AiAnalysisError(
      undefined,
      buildProviderDiagnostics(
        {
          apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          model: "gemini-3.5-flash",
        },
        "openai_compatible",
        "provider_json_parse_failed",
      ),
    );

    const metadata = buildAiInsightRefreshFailedAuditMetadata(
      "customer-uuid",
      "AI_ANALYSIS_FAILED",
      error,
    );

    assert.equal(metadata.customerId, "customer-uuid");
    assert.equal(metadata.errorCode, "AI_ANALYSIS_FAILED");
    assert.equal(metadata.providerErrorType, "provider_json_parse_failed");
    assert.equal(metadata.model, "gemini-3.5-flash");

    const serialized = JSON.stringify(metadata);
    assert.equal(serialized.includes(SECRET_API_KEY), false);
    assert.equal(serialized.includes("Bearer"), false);
    assert.equal(serialized.includes(SENSITIVE_PROMPT), false);
  });
});
