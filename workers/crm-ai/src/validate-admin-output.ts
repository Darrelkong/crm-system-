import {
  ADMIN_BRIEF_MAX_CAUTION,
  ADMIN_BRIEF_MAX_CAUTIONS,
  ADMIN_BRIEF_MAX_HEADLINE,
  ADMIN_BRIEF_MAX_PRIORITIES,
  ADMIN_BRIEF_MAX_REASON,
  ADMIN_BRIEF_MAX_SUMMARY,
  ADMIN_BRIEF_MAX_TITLE,
} from "./admin-brief";

const ADMIN_CATEGORIES = new Set([
  "approvals",
  "follow_up",
  "reclamation",
  "public_pool",
  "pipeline",
]);

const URGENCY_VALUES = new Set(["normal", "attention", "urgent"]);

function noUnsafeMarkup(value: string): boolean {
  return (
    !/<[^>]+>/.test(value) &&
    !/```/.test(value) &&
    !/javascript:/i.test(value)
  );
}

function noExternalUrl(value: string): boolean {
  return !/https?:\/\//i.test(value) && !/www\./i.test(value);
}

function safeText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    noUnsafeMarkup(value) &&
    noExternalUrl(value)
  );
}

export type AdminBriefOutput = {
  headline: string;
  summary: string;
  priorities: Array<{
    category: string;
    title: string;
    reason: string;
    urgency: string;
  }>;
  cautions: string[];
};

export function validateAdminBriefOutput(data: unknown): data is AdminBriefOutput {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "headline" && key !== "summary" && key !== "priorities" && key !== "cautions")) {
    return false;
  }

  if (!safeText(record.headline, ADMIN_BRIEF_MAX_HEADLINE)) return false;
  if (!safeText(record.summary, ADMIN_BRIEF_MAX_SUMMARY)) return false;
  if (!Array.isArray(record.priorities) || record.priorities.length > ADMIN_BRIEF_MAX_PRIORITIES) {
    return false;
  }

  for (const priority of record.priorities) {
    if (!priority || typeof priority !== "object" || Array.isArray(priority)) {
      return false;
    }
    const item = priority as Record<string, unknown>;
    if (Object.keys(item).length !== 4) return false;
    if (typeof item.category !== "string" || !ADMIN_CATEGORIES.has(item.category)) {
      return false;
    }
    if (!safeText(item.title, ADMIN_BRIEF_MAX_TITLE)) return false;
    if (!safeText(item.reason, ADMIN_BRIEF_MAX_REASON)) return false;
    if (typeof item.urgency !== "string" || !URGENCY_VALUES.has(item.urgency)) {
      return false;
    }
  }

  if (!Array.isArray(record.cautions) || record.cautions.length > ADMIN_BRIEF_MAX_CAUTIONS) {
    return false;
  }
  for (const caution of record.cautions) {
    if (!safeText(caution, ADMIN_BRIEF_MAX_CAUTION)) return false;
  }

  return true;
}
