import type { QuickEntryCanonicalCustomerFields } from "@/lib/public-pool/quick-entry-customer-validation";
import type { QuickEntryValidationResult } from "@/lib/public-pool/quick-entry-customer-validation";
import {
  QUICK_ENTRY_SERVICE_ERROR_CODES,
} from "@/lib/public-pool/quick-entry-customer-service";
import type { QuickEntryBatchClassifiedRow } from "@/lib/public-pool/quick-entry-batch-types";

export type BatchClassificationInputRow = {
  rowIndex: number;
  clientRowId: string;
  canonical: QuickEntryCanonicalCustomerFields;
  validation: QuickEntryValidationResult;
};

/**
 * Deterministic in-batch contact duplicate classification.
 * Only validated-ok rows participate as contact winners.
 * Invalid rows do not claim phone/wechat winners.
 * Duplicate rows do not register additional contacts into seen maps.
 */
export function classifyQuickEntryBatchRows(
  rows: BatchClassificationInputRow[],
): QuickEntryBatchClassifiedRow[] {
  const ordered = [...rows].sort((a, b) => a.rowIndex - b.rowIndex);
  const phoneWinners = new Map<string, number>();
  const wechatWinners = new Map<string, number>();
  const out: QuickEntryBatchClassifiedRow[] = [];

  for (const row of ordered) {
    if (!row.validation.ok) {
      out.push({
        kind: "invalid",
        rowIndex: row.rowIndex,
        clientRowId: row.clientRowId,
        errorCode:
          row.validation.errors[0]?.errorCode ??
          "QUICK_ENTRY_CUSTOMER_VALIDATION_FAILED",
      });
      continue;
    }

    const canonical = row.canonical;
    const phoneHit =
      canonical.phone != null ? phoneWinners.get(canonical.phone) : undefined;
    const wechatHit =
      canonical.wechatId != null
        ? wechatWinners.get(canonical.wechatId)
        : undefined;

    if (phoneHit != null || wechatHit != null) {
      const duplicateField = pickDuplicateField(phoneHit, wechatHit);
      out.push({
        kind: "duplicate",
        rowIndex: row.rowIndex,
        clientRowId: row.clientRowId,
        errorCode:
          duplicateField === "phone"
            ? QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_PHONE
            : QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_WECHAT,
        duplicateField,
      });
      continue;
    }

    if (canonical.phone) {
      phoneWinners.set(canonical.phone, row.rowIndex);
    }
    if (canonical.wechatId) {
      wechatWinners.set(canonical.wechatId, row.rowIndex);
    }

    out.push({
      kind: "eligible",
      rowIndex: row.rowIndex,
      clientRowId: row.clientRowId,
      normalizedCustomer: canonical,
    });
  }

  return out;
}

function pickDuplicateField(
  phoneHit: number | undefined,
  wechatHit: number | undefined,
): "phone" | "wechatId" {
  if (phoneHit != null && wechatHit != null) {
    if (phoneHit === wechatHit) return "phone";
    return phoneHit < wechatHit ? "phone" : "wechatId";
  }
  if (phoneHit != null) return "phone";
  return "wechatId";
}
