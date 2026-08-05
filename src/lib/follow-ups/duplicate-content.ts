/** Normalize follow-up body text for duplicate detection. */
export function normalizeFollowUpContentForDuplicateCheck(
  value: string,
): string {
  return value.trim().replace(/\s+/g, " ");
}

export const DUPLICATE_FOLLOW_UP_WINDOW_MS = 30 * 60 * 1000;

export type DuplicateFollowUpCheckResult =
  | { kind: "ok" }
  | {
      kind: "duplicate_requires_confirm";
      normalizedContent: string;
      previousFollowUpId: string;
      previousFollowUpTime: string;
    };

export function evaluateDuplicateFollowUpContent(input: {
  newSummary: string;
  previousSummary: string | null | undefined;
  previousFollowUpTime: string | null | undefined;
  now: Date;
  confirmed: boolean;
}): DuplicateFollowUpCheckResult {
  const normalizedContent = normalizeFollowUpContentForDuplicateCheck(
    input.newSummary,
  );
  if (!normalizedContent) {
    return { kind: "ok" };
  }

  if (input.confirmed) {
    return { kind: "ok" };
  }

  if (!input.previousSummary || !input.previousFollowUpTime) {
    return { kind: "ok" };
  }

  const previousNormalized = normalizeFollowUpContentForDuplicateCheck(
    input.previousSummary,
  );
  if (previousNormalized !== normalizedContent) {
    return { kind: "ok" };
  }

  const prevMs = new Date(input.previousFollowUpTime).getTime();
  if (
    Number.isNaN(prevMs) ||
    input.now.getTime() - prevMs > DUPLICATE_FOLLOW_UP_WINDOW_MS
  ) {
    return { kind: "ok" };
  }

  return {
    kind: "duplicate_requires_confirm",
    normalizedContent,
    previousFollowUpId: "",
    previousFollowUpTime: input.previousFollowUpTime,
  };
}
