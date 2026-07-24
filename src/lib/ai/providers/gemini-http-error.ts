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
  unknownSchemaKeyword?: string;
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

const UNKNOWN_NAME_RE = /Unknown name\s+"([^"]{1,80})"/i;

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
  return match[0].replace(/['"]/g, "").slice(0, 200);
}

function collectUnknownSchemaKeyword(message: string): string | undefined {
  const match = message.match(UNKNOWN_NAME_RE);
  const name = match?.[1]?.trim();
  if (!name) {
    return undefined;
  }
  return name.slice(0, 80);
}

function collectTextsFromGeminiError(error: Record<string, unknown>): string[] {
  const texts: string[] = [];
  if (typeof error.message === "string" && error.message.length > 0) {
    texts.push(error.message);
  }

  const details = error.details;
  if (!Array.isArray(details)) {
    return texts;
  }

  for (const detail of details) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
      continue;
    }
    const violations = (detail as { fieldViolations?: unknown }).fieldViolations;
    if (!Array.isArray(violations)) {
      continue;
    }
    for (const violation of violations) {
      if (!violation || typeof violation !== "object" || Array.isArray(violation)) {
        continue;
      }
      const record = violation as { field?: unknown; description?: unknown };
      if (typeof record.field === "string" && record.field.length > 0) {
        texts.push(record.field);
      }
      if (typeof record.description === "string" && record.description.length > 0) {
        texts.push(record.description);
      }
    }
  }

  return texts;
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

  const texts = collectTextsFromGeminiError(record);
  if (texts.length === 0) {
    return details;
  }

  const combined = texts.join("\n");
  const keywordHint = collectSchemaKeywordHint(combined);
  if (keywordHint) {
    details.schemaKeywordHint = keywordHint;
  }
  const pathHint =
    texts.map(collectSchemaPathHint).find((value) => value !== undefined) ??
    collectSchemaPathHint(combined);
  if (pathHint) {
    details.schemaPathHint = pathHint;
  }
  const unknownKeyword =
    texts.map(collectUnknownSchemaKeyword).find((value) => value !== undefined) ??
    collectUnknownSchemaKeyword(combined);
  if (unknownKeyword) {
    details.unknownSchemaKeyword = unknownKeyword;
  }

  return details;
}
