import {
  isSalesStage,
  LEGACY_SALES_STAGES,
} from "@/lib/constants/customer-fields";
import { STAGE_DIST_NOT_SET } from "@/lib/reports/dashboard-stage-catalog";

export { STAGE_DIST_NOT_SET };

export function isValidSalesStageListFilter(
  value: string | undefined | null,
): value is string {
  if (!value?.trim()) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed === STAGE_DIST_NOT_SET) {
    return true;
  }
  return isSalesStage(trimmed) ||
    (LEGACY_SALES_STAGES as readonly string[]).includes(trimmed);
}

export function parseSalesStageListParam(
  value: string | undefined | null,
): string | undefined {
  if (!isValidSalesStageListFilter(value)) {
    return undefined;
  }
  return value!.trim();
}

export function isValidAdminOwnerListParam(
  value: string | undefined | null,
): boolean {
  if (!value?.trim()) {
    return false;
  }
  return /^[0-9a-f-]{36}$/i.test(value.trim());
}

export function parseAdminOwnerListParam(
  value: string | undefined | null,
): string | undefined {
  if (!isValidAdminOwnerListParam(value)) {
    return undefined;
  }
  return value!.trim();
}
