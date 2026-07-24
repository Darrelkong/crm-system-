import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_INSIGHT_JSON_SCHEMA,
  CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA,
} from "@/lib/ai/customer-insights/json-schema";
import {
  PHASE2_EXTRACTED_SIGNALS_JSON_SCHEMA,
  PHASE2_EXTRACTED_SIGNALS_NATIVE_RESPONSE_SCHEMA,
  PHASE2_PROVIDER_FORBIDDEN_FIELDS,
  findGeminiUnsupportedSchemaPaths,
} from "@/lib/ai/phase2/provider-json-schema";
import { safeParsePhase2ExtractedSignals } from "@/lib/ai/phase2";

const EMPTY_VALID_SIGNALS = {
  needClarity: null,
  customerInitiative: null,
  timelineReadiness: null,
  documentReadiness: null,
  concerns: [],
  customerBehaviorRisk: [],
  recommendedTopic: null,
};

describe("Phase 2 provider JSON schema contracts", () => {
  it("OpenAI-compatible schema keeps anyOf for nullable phase2Signals", () => {
    const phase2 = CUSTOMER_INSIGHT_JSON_SCHEMA.properties.phase2Signals as unknown as {
      anyOf?: unknown[];
    };
    assert.ok(Array.isArray(phase2.anyOf));
    assert.equal(phase2.anyOf?.length, 2);
  });

  it("Gemini native Phase 2 schema has no unsupported keywords", () => {
    assert.deepEqual(
      findGeminiUnsupportedSchemaPaths(
        PHASE2_EXTRACTED_SIGNALS_NATIVE_RESPONSE_SCHEMA,
      ),
      [],
    );
    assert.deepEqual(
      findGeminiUnsupportedSchemaPaths(CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA),
      [],
    );
  });

  it("OpenAI Phase 2 draft still uses anyOf (detected by Gemini checker)", () => {
    const paths = findGeminiUnsupportedSchemaPaths(
      PHASE2_EXTRACTED_SIGNALS_JSON_SCHEMA,
    );
    assert.ok(paths.some((path) => path.includes("anyOf")));
  });

  it("native and OpenAI Phase 2 schemas share the same required keys", () => {
    assert.deepEqual(
      [...PHASE2_EXTRACTED_SIGNALS_NATIVE_RESPONSE_SCHEMA.required].sort(),
      [...PHASE2_EXTRACTED_SIGNALS_JSON_SCHEMA.required].sort(),
    );
  });

  it("empty Phase 2 signals shape is valid for server-side parse", () => {
    const parsed = safeParsePhase2ExtractedSignals(EMPTY_VALID_SIGNALS);
    assert.equal(parsed.success, true);
  });

  it("provider schemas do not advertise forbidden final score fields", () => {
    const serialized = JSON.stringify({
      openai: PHASE2_EXTRACTED_SIGNALS_JSON_SCHEMA,
      native: PHASE2_EXTRACTED_SIGNALS_NATIVE_RESPONSE_SCHEMA,
    });
    for (const field of PHASE2_PROVIDER_FORBIDDEN_FIELDS) {
      const leaf = field.includes(".") ? field.split(".").pop()! : field;
      if (leaf === "intentScore") {
        // Base deep-analysis field — must remain on customer insight schema only.
        assert.equal(
          JSON.stringify(PHASE2_EXTRACTED_SIGNALS_NATIVE_RESPONSE_SCHEMA).includes(
            leaf,
          ),
          false,
        );
        continue;
      }
      assert.equal(
        serialized.includes(`"${leaf}"`),
        false,
        `forbidden field leaked into Phase 2 provider schema: ${field}`,
      );
    }
  });

  it("detects type union arrays as Gemini-unsupported", () => {
    assert.deepEqual(findGeminiUnsupportedSchemaPaths({ type: ["string", "null"] }), [
      "type",
    ]);
  });
});
