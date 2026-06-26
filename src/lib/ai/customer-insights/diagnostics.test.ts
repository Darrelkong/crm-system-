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

describe("AI insight failure diagnostics", () => {
  it("toSafeFailureAuditMetadata only exposes allowed troubleshooting fields", () => {
    const diagnostics = buildProviderDiagnostics(
      {
        apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        model: "gemini-3.5-flash",
      },
      "openai_compatible",
      "provider_http_error",
      401,
    );

    const metadata = toSafeFailureAuditMetadata({
      ...diagnostics,
      apiKey: SECRET_API_KEY,
      authorization: `Bearer ${SECRET_API_KEY}`,
      prompt: SENSITIVE_PROMPT,
    } as AiProviderDiagnostics);

    assert.deepEqual(metadata, {
      providerKind: "openai_compatible",
      model: "gemini-3.5-flash",
      providerErrorType: "provider_http_error",
      httpStatus: 401,
      requestUrlHost: "generativelanguage.googleapis.com",
      requestUrlPath: "/v1beta/openai/chat/completions",
    });

    const serialized = JSON.stringify(metadata);
    assert.equal(serialized.includes(SECRET_API_KEY), false);
    assert.equal(serialized.includes("Bearer"), false);
    assert.equal(serialized.includes("Authorization"), false);
    assert.equal(serialized.includes("张三"), false);
    assert.equal(serialized.includes("13800138000"), false);
    assert.equal(serialized.includes(SENSITIVE_PROMPT), false);
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
