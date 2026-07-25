/**
 * Server-side AI insight generation identity (Phase 5D-1).
 * Never trust a client-provided generationKey — rebuild and verify here.
 */

export const AI_INSIGHT_GENERATION_KEY_SEPARATOR = "|" as const;
export const AI_INSIGHT_GENERATION_KEY_MAX_LENGTH = 512;

export type AiInsightGenerationKeyParts = {
  aiInsightId: string;
  insightGeneratedAt: string;
  sourceHash: string;
};

export class AiInsightGenerationKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiInsightGenerationKeyError";
  }
}

const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function normalizePart(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new AiInsightGenerationKeyError(`${field} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AiInsightGenerationKeyError(`${field} must be a non-empty string`);
  }
  if (trimmed.includes(AI_INSIGHT_GENERATION_KEY_SEPARATOR)) {
    throw new AiInsightGenerationKeyError(
      `${field} must not contain generation key separator`,
    );
  }
  return trimmed;
}

function assertValidGeneratedAt(value: string): void {
  if (!ISO_INSTANT_RE.test(value)) {
    throw new AiInsightGenerationKeyError(
      "insightGeneratedAt must be an ISO-8601 UTC instant",
    );
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new AiInsightGenerationKeyError(
      "insightGeneratedAt must be an ISO-8601 UTC instant",
    );
  }
}

/**
 * Canonical generation key:
 * `<aiInsightId>|<insightGeneratedAt>|<sourceHash>`
 *
 * Deterministic and reproducible in SQL via:
 * `trim(ai_insight_id) || '|' || trim(insight_generated_at) || '|' || trim(source_hash)`
 */
export function buildAiInsightGenerationKey(
  parts: AiInsightGenerationKeyParts,
): string {
  const aiInsightId = normalizePart(parts.aiInsightId, "aiInsightId");
  const insightGeneratedAt = normalizePart(
    parts.insightGeneratedAt,
    "insightGeneratedAt",
  );
  assertValidGeneratedAt(insightGeneratedAt);
  const sourceHash = normalizePart(parts.sourceHash, "sourceHash");

  const key = `${aiInsightId}${AI_INSIGHT_GENERATION_KEY_SEPARATOR}${insightGeneratedAt}${AI_INSIGHT_GENERATION_KEY_SEPARATOR}${sourceHash}`;
  if (key.length > AI_INSIGHT_GENERATION_KEY_MAX_LENGTH) {
    throw new AiInsightGenerationKeyError("generationKey exceeds max length");
  }
  return key;
}

export function parseAiInsightGenerationKey(
  generationKey: string,
): AiInsightGenerationKeyParts {
  if (typeof generationKey !== "string" || generationKey.trim().length === 0) {
    throw new AiInsightGenerationKeyError("generationKey must be a non-empty string");
  }
  const parts = generationKey.split(AI_INSIGHT_GENERATION_KEY_SEPARATOR);
  if (parts.length !== 3) {
    throw new AiInsightGenerationKeyError("generationKey has invalid format");
  }
  const [aiInsightId, insightGeneratedAt, sourceHash] = parts;
  return {
    aiInsightId: normalizePart(aiInsightId, "aiInsightId"),
    insightGeneratedAt: normalizePart(insightGeneratedAt, "insightGeneratedAt"),
    sourceHash: normalizePart(sourceHash, "sourceHash"),
  };
}
