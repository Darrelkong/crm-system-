/**
 * Schema complexity stats for Gemini Flat candidate vs Production Base-12.
 * Pure helpers for tests — not used at runtime.
 */
import { CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA } from "@/lib/ai/customer-insights/json-schema";
import { CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA } from "@/lib/ai/phase2/gemini-phase2-flat-schema";
import { findGeminiUnsupportedSchemaPaths } from "@/lib/ai/phase2/provider-json-schema";
import { GEMINI_PHASE2_FLAT_ROOT_FIELD } from "@/lib/ai/phase2/gemini-phase2-flat-contract";

export type GeminiSchemaComplexityStats = {
  serializedLength: number;
  maxDepth: number;
  propertyCount: number;
  objectCount: number;
  arrayCount: number;
  enumCount: number;
  minimumCount: number;
  maximumCount: number;
  nullableCount: number;
  requiredKeyCount: number;
  unsupportedPaths: string[];
  requiredMismatchPaths: string[];
};

function walkSchema(
  node: unknown,
  path: string,
  depth: number,
  acc: {
    maxDepth: number;
    propertyCount: number;
    objectCount: number;
    arrayCount: number;
    enumCount: number;
    minimumCount: number;
    maximumCount: number;
    nullableCount: number;
    requiredKeyCount: number;
    requiredMismatchPaths: string[];
  },
): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return;
  }

  const record = node as Record<string, unknown>;
  acc.maxDepth = Math.max(acc.maxDepth, depth);

  if (record.type === "object" || record.properties) {
    acc.objectCount += 1;
  }
  if (record.type === "array") {
    acc.arrayCount += 1;
  }
  if (Array.isArray(record.enum)) {
    acc.enumCount += 1;
  }
  if ("minimum" in record) {
    acc.minimumCount += 1;
  }
  if ("maximum" in record) {
    acc.maximumCount += 1;
  }
  if (record.nullable === true) {
    acc.nullableCount += 1;
  }

  const properties = record.properties;
  const required = Array.isArray(record.required)
    ? (record.required as string[])
    : [];
  acc.requiredKeyCount += required.length;

  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const propRecord = properties as Record<string, unknown>;
    const propKeys = Object.keys(propRecord);
    acc.propertyCount += propKeys.length;

    for (const key of required) {
      if (!(key in propRecord)) {
        acc.requiredMismatchPaths.push(
          path ? `${path}.required.${key}` : `required.${key}`,
        );
      }
    }

    for (const [key, child] of Object.entries(propRecord)) {
      const childPath = path ? `${path}.${key}` : key;
      walkSchema(child, childPath, depth + 1, acc);
    }
  }

  if (record.items) {
    walkSchema(record.items, `${path}[]`, depth + 1, acc);
  }
}

export function measureGeminiSchemaComplexity(
  schema: unknown,
): GeminiSchemaComplexityStats {
  const acc = {
    maxDepth: 0,
    propertyCount: 0,
    objectCount: 0,
    arrayCount: 0,
    enumCount: 0,
    minimumCount: 0,
    maximumCount: 0,
    nullableCount: 0,
    requiredKeyCount: 0,
    requiredMismatchPaths: [] as string[],
  };
  walkSchema(schema, "", 0, acc);
  return {
    serializedLength: JSON.stringify(schema).length,
    maxDepth: acc.maxDepth,
    propertyCount: acc.propertyCount,
    objectCount: acc.objectCount,
    arrayCount: acc.arrayCount,
    enumCount: acc.enumCount,
    minimumCount: acc.minimumCount,
    maximumCount: acc.maximumCount,
    nullableCount: acc.nullableCount,
    requiredKeyCount: acc.requiredKeyCount,
    unsupportedPaths: findGeminiUnsupportedSchemaPaths(schema),
    requiredMismatchPaths: acc.requiredMismatchPaths,
  };
}

export function measureProductionGeminiBaseSchemaComplexity() {
  return measureGeminiSchemaComplexity(CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA);
}

export function measureGeminiFlatCandidateSchemaComplexity() {
  return measureGeminiSchemaComplexity(
    CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA,
  );
}

/** Phase-2-only subtree stats for the Flat candidate. */
export function measureGeminiFlatPhase2SubtreeComplexity() {
  const phase2 =
    CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA.properties[
      GEMINI_PHASE2_FLAT_ROOT_FIELD
    ];
  return measureGeminiSchemaComplexity({
    type: "object",
    properties: { [GEMINI_PHASE2_FLAT_ROOT_FIELD]: phase2 },
    required: [GEMINI_PHASE2_FLAT_ROOT_FIELD],
  });
}
