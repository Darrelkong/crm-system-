import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSafeGeminiHttpErrorDetails } from "./gemini-http-error";

const CUSTOMER_PII = "张三 13800138000 customer@example.com";
const RAW_PROMPT = "Analyze this private follow-up note about budget";

describe("extractSafeGeminiHttpErrorDetails", () => {
  it("extracts status, code, schema keyword and path hints", () => {
    const details = extractSafeGeminiHttpErrorDetails({
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message:
          "Invalid JSON payload received. Unknown name \"nullable\" at 'generation_config.response_schema.properties.phase2Signals': Cannot find field.",
      },
    });

    assert.equal(details.failureStage, "provider_http");
    assert.equal(details.geminiApiStatus, "INVALID_ARGUMENT");
    assert.equal(details.geminiErrorCode, 400);
    assert.equal(details.unknownSchemaKeyword, "nullable");
    assert.ok(details.schemaKeywordHint?.includes("nullable"));
    assert.ok(details.schemaKeywordHint?.includes("phase2Signals"));
    assert.ok(details.schemaKeywordHint?.includes("Unknown name"));
    assert.match(
      details.schemaPathHint ?? "",
      /generation_config\.response_schema\.properties\.phase2Signals/i,
    );
  });

  it("reads fieldViolations when top-level message omits the path", () => {
    const details = extractSafeGeminiHttpErrorDetails({
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: "Request contains an invalid argument.",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.BadRequest",
            fieldViolations: [
              {
                field:
                  "generation_config.response_schema.properties[12].value",
                description:
                  'Invalid JSON payload received. Unknown name "maxLength" at \'generation_config.response_schema.properties[12].value\'',
              },
            ],
          },
        ],
      },
    });

    assert.equal(details.unknownSchemaKeyword, "maxLength");
    assert.ok(details.schemaKeywordHint?.includes("maxLength"));
    assert.match(
      details.schemaPathHint ?? "",
      /generation_config\.response_schema\.properties\[12\]\.value/i,
    );
  });

  it("never stores raw message, PII, or prompt text", () => {
    const details = extractSafeGeminiHttpErrorDetails({
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: `Invalid value near ${CUSTOMER_PII} prompt=${RAW_PROMPT} Unknown name \"anyOf\" at 'generation_config.response_schema.properties.x'`,
      },
    });

    const serialized = JSON.stringify(details);
    assert.equal(serialized.includes(CUSTOMER_PII), false);
    assert.equal(serialized.includes("13800138000"), false);
    assert.equal(serialized.includes("customer@example.com"), false);
    assert.equal(serialized.includes(RAW_PROMPT), false);
    assert.equal(serialized.includes("张三"), false);
    assert.ok(details.schemaKeywordHint?.includes("anyOf"));
  });

  it("returns only failureStage when body has no usable error", () => {
    assert.deepEqual(extractSafeGeminiHttpErrorDetails(null), {
      failureStage: "provider_http",
    });
    assert.deepEqual(extractSafeGeminiHttpErrorDetails({}), {
      failureStage: "provider_http",
    });
    assert.deepEqual(extractSafeGeminiHttpErrorDetails({ error: "oops" }), {
      failureStage: "provider_http",
    });
  });

  it("rejects non-allowlisted status strings", () => {
    const details = extractSafeGeminiHttpErrorDetails({
      error: {
        status: "not a status",
        message: "something unrelated",
      },
    });
    assert.equal(details.geminiApiStatus, undefined);
    assert.equal(details.schemaKeywordHint, undefined);
  });
});
