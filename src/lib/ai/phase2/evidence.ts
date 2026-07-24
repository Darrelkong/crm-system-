import {
  CUSTOMER_FIELD_WHITELIST,
  PHASE2_LIMITS,
  type EvidenceReference,
  type Phase2Context,
} from "@/lib/ai/phase2/types";

export type EvidenceValidationResult =
  | { ok: true; evidence: EvidenceReference }
  | { ok: false; reason: string };

function normalizeForContainment(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，。！？、；：""''（）()【】\[\]<>《》·•…]/g, "")
    .toLowerCase();
}

export function clipEvidenceExcerpt(excerpt: string): string {
  const trimmed = excerpt.trim();
  if (trimmed.length <= PHASE2_LIMITS.evidenceExcerptMaxChars) {
    return trimmed;
  }
  return trimmed.slice(0, PHASE2_LIMITS.evidenceExcerptMaxChars);
}

/**
 * Masks common sensitive tokens in evidence excerpts for UI display.
 * Does not mutate stored follow-up text.
 */
export function maskEvidenceExcerpt(excerpt: string): string {
  let out = excerpt;
  out = out.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[email]",
  );
  out = out.replace(
    /(?:微信|wechat|wx)[:：\s]*[A-Za-z0-9_\-]{4,}/gi,
    "[wechat]",
  );
  // Bank-like long digit runs first (12–19 contiguous digits).
  out = out.replace(/\b\d{12,19}\b/g, "[account]");
  // Passport / ID-like alnum runs.
  out = out.replace(
    /\b(?:[A-Z]{1,2}\d{7,9}|\d{15}|\d{17}[\dXx])\b/g,
    "[id]",
  );
  out = out.replace(
    /https?:\/\/[^\s]+[?&](?:token|access_token|key)=[^\s&]+/gi,
    "[url]",
  );
  // Phones: require + or separators / length after digit normalization.
  out = out.replace(/(?:\+\d[\d\s\-()]{8,}\d)|(?:\b0?\d{2,4}[\s\-]\d{3,4}[\s\-]\d{3,4}\b)/g, "[phone]");
  out = out.replace(/\b1[3-9]\d[\s\-]?\d{4}[\s\-]?\d{4}\b/g, "[phone]");
  return out;
}

function resolveSourceText(
  evidence: EvidenceReference,
  context: Phase2Context,
): string | null {
  if (evidence.sourceType === "initial_note") {
    return context.initialNote;
  }
  if (evidence.sourceType === "follow_up") {
    if (!evidence.sourceId) return null;
    const row = context.recentFollowUps.find((f) => f.id === evidence.sourceId);
    if (!row) return null;
    return [row.summary, row.nextAction, row.customerIntent]
      .filter(Boolean)
      .join("\n");
  }
  if (evidence.sourceType === "customer_field") {
    if (
      !evidence.field ||
      !(CUSTOMER_FIELD_WHITELIST as readonly string[]).includes(evidence.field)
    ) {
      return null;
    }
    switch (evidence.field) {
      case "requested_project_name":
        return context.requestedProjectName;
      case "sales_stage":
        return context.salesStage;
      case "source":
        return context.source;
      case "next_follow_up_at":
        return context.nextFollowUpAt;
      case "last_follow_up_at":
        return context.lastFollowUpAt;
      case "last_valid_follow_up_at":
        return context.lastValidFollowUpAt;
      case "created_at":
        return context.createdAt;
      case "customer_intent":
        return context.customerIntent;
      default:
        return null;
    }
  }
  if (evidence.sourceType === "system_rule") {
    // System-rule excerpts are fixed codes / short labels, not free text from CRM.
    return evidence.excerpt;
  }
  return null;
}

export function excerptExistsInSource(
  excerpt: string,
  sourceText: string,
): boolean {
  const needle = normalizeForContainment(excerpt);
  const haystack = normalizeForContainment(sourceText);
  if (!needle || !haystack) return false;
  return haystack.includes(needle);
}

export function validateEvidenceReference(
  evidence: EvidenceReference,
  context: Phase2Context,
): EvidenceValidationResult {
  const clipped = clipEvidenceExcerpt(evidence.excerpt);
  if (!clipped) {
    return { ok: false, reason: "empty_excerpt" };
  }
  if (clipped.length > PHASE2_LIMITS.evidenceExcerptMaxChars) {
    return { ok: false, reason: "excerpt_too_long" };
  }

  if (evidence.sourceType === "follow_up") {
    if (!evidence.sourceId) {
      return { ok: false, reason: "missing_follow_up_id" };
    }
    const belongs = context.recentFollowUps.some(
      (f) => f.id === evidence.sourceId,
    );
    if (!belongs) {
      return { ok: false, reason: "follow_up_not_in_context" };
    }
  }

  if (evidence.sourceType === "customer_field") {
    if (
      !evidence.field ||
      !(CUSTOMER_FIELD_WHITELIST as readonly string[]).includes(evidence.field)
    ) {
      return { ok: false, reason: "customer_field_not_allowed" };
    }
  }

  if (evidence.sourceType === "system_rule") {
    if (!evidence.sourceId || !/^RULE_[A-Z0-9_]+$/.test(evidence.sourceId)) {
      return { ok: false, reason: "invalid_system_rule_code" };
    }
    return {
      ok: true,
      evidence: { ...evidence, excerpt: clipped },
    };
  }

  const sourceText = resolveSourceText(evidence, context);
  if (!sourceText) {
    return { ok: false, reason: "source_text_missing" };
  }
  if (!excerptExistsInSource(clipped, sourceText)) {
    return { ok: false, reason: "excerpt_not_in_source" };
  }

  return {
    ok: true,
    evidence: { ...evidence, excerpt: clipped },
  };
}

/**
 * Mask only after excerpt containment validation against the raw source text.
 * Never mask the source first and then accept a loosely matched excerpt.
 */
export function maskValidatedEvidence(
  evidence: EvidenceReference,
): EvidenceReference {
  return {
    ...evidence,
    excerpt: maskEvidenceExcerpt(evidence.excerpt),
  };
}

export function validateEvidenceList(
  list: EvidenceReference[],
  context: Phase2Context,
  max: number = PHASE2_LIMITS.evidencePerFactorMax,
): { ok: true; evidence: EvidenceReference[] } | { ok: false; reason: string } {
  if (list.length > max) {
    return { ok: false, reason: "too_many_evidence" };
  }
  const out: EvidenceReference[] = [];
  for (const item of list) {
    const result = validateEvidenceReference(item, context);
    if (!result.ok) return result;
    out.push(maskValidatedEvidence(result.evidence));
  }
  return { ok: true, evidence: out };
}

export function filterValidSignalsEvidence<T extends { evidence: EvidenceReference[] }>(
  signal: T,
  context: Phase2Context,
): T | null {
  const validated = validateEvidenceList(signal.evidence, context);
  if (!validated.ok || validated.evidence.length === 0) return null;
  return { ...signal, evidence: validated.evidence };
}
