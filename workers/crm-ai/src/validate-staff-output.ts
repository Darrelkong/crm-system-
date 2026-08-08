import {
  STAFF_ACTIONS_MAX_ACTIONS,
  STAFF_ACTIONS_MAX_HEADLINE,
  STAFF_ACTIONS_MAX_REASON,
  STAFF_ACTIONS_MAX_TITLE,
} from "./staff-actions";

const STAFF_CATEGORIES = new Set([
  "follow_up",
  "overdue",
  "reclamation",
  "work_item",
]);

const URGENCY_VALUES = new Set(["normal", "attention", "urgent"]);
const CUSTOMER_REF_PATTERN = /^C\d+$/;

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

export type StaffTodayActionsOutput = {
  headline: string;
  actions: Array<{
    customerRef?: string;
    category: string;
    title: string;
    reason: string;
    urgency: string;
  }>;
};

export function validateStaffActionsOutput(
  data: unknown,
  allowedCustomerRefs: Set<string>,
): data is StaffTodayActionsOutput {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  if (Object.keys(record).length !== 2) return false;

  if (!safeText(record.headline, STAFF_ACTIONS_MAX_HEADLINE)) return false;
  if (!Array.isArray(record.actions) || record.actions.length > STAFF_ACTIONS_MAX_ACTIONS) {
    return false;
  }

  for (const action of record.actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      return false;
    }
    const item = action as Record<string, unknown>;
    const keys = Object.keys(item);
    if (
      keys.length < 4 ||
      keys.length > 5 ||
      !keys.includes("category") ||
      !keys.includes("title") ||
      !keys.includes("reason") ||
      !keys.includes("urgency")
    ) {
      return false;
    }
    if (typeof item.category !== "string" || !STAFF_CATEGORIES.has(item.category)) {
      return false;
    }
    if (!safeText(item.title, STAFF_ACTIONS_MAX_TITLE)) return false;
    if (!safeText(item.reason, STAFF_ACTIONS_MAX_REASON)) return false;
    if (typeof item.urgency !== "string" || !URGENCY_VALUES.has(item.urgency)) {
      return false;
    }
    if (item.customerRef !== undefined) {
      if (
        typeof item.customerRef !== "string" ||
        !CUSTOMER_REF_PATTERN.test(item.customerRef) ||
        !allowedCustomerRefs.has(item.customerRef)
      ) {
        return false;
      }
    }
  }

  return true;
}
