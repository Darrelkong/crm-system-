/**
 * Safe extraction of Gemini HTTP error details for audit metadata.
 * Never stores raw response bodies, prompts, or customer content.
 */

export type SafeGeminiHttpErrorDetails = {
  failureStage: "provider_http";
  geminiApiStatus?: string;
  geminiErrorCode?: number;
  schemaKeywordHint?: string;
  schemaPathHint?: string;
};

const GEMINI_API_STATUS_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

const SCHEMA_KEYWORD_ALLOWLIST = [
  "anyOf",
  "oneOf",
  "allOf",
  "$ref",
  "additionalProperties",
  "nullable",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "propertyOrdering",
  "phase2Signals",
  "Unknown name",
  "Invalid JSON payload",
  "Invalid value",
  "type",
  "required",
  "properties",
  "enum",
  "items",
] as const;

const SCHEMA_PATH_RE =
  /(?:generation_config\.)?response_schema[\w.\[\]"'*]{0,180}/i;

function collectSchemaKeywordHint(message: string): string | undefined {
  const hits = new Set<string>();
  const lower = message.toLowerCase();
  for (const keyword of SCHEMA_KEYWORD_ALLOWLIST) {
    if (lower.includes(keyword.toLowerCase())) {
      hits.add(keyword);
    }
  }
  if (hits.size === 0) {
    return undefined;
  }
  return [...hits].sort().join(",").slice(0, 120);
}

function collectSchemaPathHint(message: string): string | undefined {
  const match = message.match(SCHEMA_PATH_RE);
  if (!match?.[0]) {
    return undefined;
  }
  // Structural schema path only — strip quotes that might wrap fragments.
  return match[0].replace(/['"]/g, "").slice(0, 200);
}

/**
 * Pulls only allowlisted troubleshooting fields from a Gemini error JSON body.
 */
export function extractSafeGeminiHttpErrorDetails(
  data: unknown,
): SafeGeminiHttpErrorDetails {
  const details: SafeGeminiHttpErrorDetails = {
    failureStage: "provider_http",
  };

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return details;
  }

  const error = (data as { error?: unknown }).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return details;
  }

  const record = error as Record<string, unknown>;

  if (typeof record.status === "string" && GEMINI_API_STATUS_RE.test(record.status)) {
    details.geminiApiStatus = record.status;
  }

  if (typeof record.code === "number" && Number.isFinite(record.code)) {
    details.geminiErrorCode = Math.trunc(record.code);
  }

  if (typeof record.message === "string" && record.message.length > 0) {
    const keywordHint = collectSchemaKeywordHint(record.message);
    if (keywordHint) {
      details.schemaKeywordHint = keywordHint;
    }
    const pathHint = collectSchemaPathHint(record.message);
    if (pathHint) {
      details.schemaPathHint = pathHint;
    }
  }

  return details;
}
