import type { RequestedProjectLocale } from "@/lib/constants/requested-projects";
import {
  getRequestedProjectItem,
  isRequestedProjectOtherCode,
} from "@/lib/constants/requested-projects";

/**
 * Display helper for customer requested project.
 * - Valid standard code → catalog label for locale
 * - code = other → manual requestedProjectName
 * - code = null → raw requestedProjectName (legacy)
 * - Unknown code → safe fallback to name (never show raw code)
 */
export function resolveRequestedProjectDisplayName(params: {
  requestedProjectCode: string | null | undefined;
  requestedProjectName: string | null | undefined;
  locale: RequestedProjectLocale;
}): string {
  const { requestedProjectCode, requestedProjectName, locale } = params;
  const fallback =
    typeof requestedProjectName === "string" ? requestedProjectName.trim() : "";

  if (!requestedProjectCode) {
    return fallback;
  }

  if (isRequestedProjectOtherCode(requestedProjectCode)) {
    return fallback;
  }

  const item = getRequestedProjectItem(requestedProjectCode);
  if (!item) {
    return fallback;
  }

  return item.labels[locale] || item.canonicalZhHans || fallback;
}
