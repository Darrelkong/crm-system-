import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProviderDiagnostics } from "./diagnostics";
import {
  getSafeAiRefreshErrorMessage,
  mapAiAnalysisErrorCode,
  resolveAiRefreshErrorCode,
} from "./error-mapping";
import { AiAnalysisError, AiConfigError, AiRefreshDeniedError } from "./errors";

const providerConfig = {
  apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
  model: "gemini-3.5-flash",
};

const SECRET_API_KEY = "sk-gemini-secret-key-do-not-log";
const PROVIDER_RAW_BODY = "upstream raw error with invalid api key";

describe("mapAiAnalysisErrorCode", () => {
  it("maps provider HTTP 503 to AI_PROVIDER_TEMPORARILY_UNAVAILABLE", () => {
    assert.equal(
      mapAiAnalysisErrorCode(
        buildProviderDiagnostics(
          providerConfig,
          "openai_compatible",
          "provider_http_error",
          503,
        ),
      ),
      "AI_PROVIDER_TEMPORARILY_UNAVAILABLE",
    );
  });

  it("maps provider HTTP 429 to AI_RATE_LIMITED", () => {
    assert.equal(
      mapAiAnalysisErrorCode(
        buildProviderDiagnostics(
          providerConfig,
          "openai_compatible",
          "provider_http_error",
          429,
        ),
      ),
      "AI_RATE_LIMITED",
    );
  });

  it("maps provider_request_failed to AI_PROVIDER_TIMEOUT", () => {
    assert.equal(
      mapAiAnalysisErrorCode(
        buildProviderDiagnostics(
          providerConfig,
          "openai_compatible",
          "provider_request_failed",
        ),
      ),
      "AI_PROVIDER_TIMEOUT",
    );
  });

  it("maps JSON parse failures to AI_PROVIDER_RESPONSE_INVALID", () => {
    assert.equal(
      mapAiAnalysisErrorCode(
        buildProviderDiagnostics(
          providerConfig,
          "openai_compatible",
          "provider_json_parse_failed",
        ),
      ),
      "AI_PROVIDER_RESPONSE_INVALID",
    );
  });

  it("maps empty content to AI_PROVIDER_RESPONSE_INVALID", () => {
    assert.equal(
      mapAiAnalysisErrorCode(
        buildProviderDiagnostics(
          providerConfig,
          "openai_compatible",
          "provider_empty_content",
        ),
      ),
      "AI_PROVIDER_RESPONSE_INVALID",
    );
  });

  it("maps schema validation failures to AI_PROVIDER_RESPONSE_INVALID", () => {
    assert.equal(
      mapAiAnalysisErrorCode(
        buildProviderDiagnostics(
          providerConfig,
          "openai_compatible",
          "schema_validation_failed",
        ),
      ),
      "AI_PROVIDER_RESPONSE_INVALID",
    );
  });

  it("maps other HTTP errors to AI_ANALYSIS_FAILED", () => {
    assert.equal(
      mapAiAnalysisErrorCode(
        buildProviderDiagnostics(
          providerConfig,
          "openai_compatible",
          "provider_http_error",
          401,
        ),
      ),
      "AI_ANALYSIS_FAILED",
    );
  });

  it("falls back to AI_ANALYSIS_FAILED when diagnostics are missing", () => {
    assert.equal(mapAiAnalysisErrorCode(undefined), "AI_ANALYSIS_FAILED");
  });
});

describe("resolveAiRefreshErrorCode", () => {
  it("preserves config error codes", () => {
    assert.equal(resolveAiRefreshErrorCode(new AiConfigError()), "AI_NOT_CONFIGURED");
    assert.equal(
      resolveAiRefreshErrorCode(new AiConfigError("bad url", "AI_CONFIG_ERROR")),
      "AI_CONFIG_ERROR",
    );
  });

  it("preserves mapped analysis error codes", () => {
    const error = new AiAnalysisError(
      undefined,
      buildProviderDiagnostics(
        providerConfig,
        "openai_compatible",
        "provider_http_error",
        503,
      ),
      "AI_PROVIDER_TEMPORARILY_UNAVAILABLE",
    );
    assert.equal(resolveAiRefreshErrorCode(error), "AI_PROVIDER_TEMPORARILY_UNAVAILABLE");
  });

  it("preserves refresh denied code", () => {
    assert.equal(resolveAiRefreshErrorCode(new AiRefreshDeniedError()), "AI_REFRESH_DENIED");
  });
});

describe("getSafeAiRefreshErrorMessage", () => {
  it("returns safe messages without provider raw errors or secrets", () => {
    const message = getSafeAiRefreshErrorMessage("AI_PROVIDER_TEMPORARILY_UNAVAILABLE");
    assert.equal(message.includes(PROVIDER_RAW_BODY), false);
    assert.equal(message.includes(SECRET_API_KEY), false);
    assert.equal(message.includes("503"), false);
    assert.equal(message.includes("Bearer"), false);
  });

  it("maps each public error code to a non-empty message", () => {
    const codes = [
      "AI_NOT_CONFIGURED",
      "AI_CONFIG_ERROR",
      "AI_PROVIDER_TEMPORARILY_UNAVAILABLE",
      "AI_RATE_LIMITED",
      "AI_PROVIDER_TIMEOUT",
      "AI_PROVIDER_RESPONSE_INVALID",
      "AI_ANALYSIS_FAILED",
      "AI_REFRESH_DENIED",
    ] as const;

    for (const code of codes) {
      const message = getSafeAiRefreshErrorMessage(code);
      assert.equal(message.length > 0, true);
      assert.equal(message.includes(SECRET_API_KEY), false);
    }
  });
});
