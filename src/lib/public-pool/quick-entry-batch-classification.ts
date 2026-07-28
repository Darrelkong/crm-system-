import type { QuickEntryCanonicalCustomerFields } from "@/lib/public-pool/quick-entry-customer-validation";
import type { QuickEntryValidationResult } from "@/lib/public-pool/quick-entry-customer-validation";
import {
  QUICK_ENTRY_SERVICE_ERROR_CODES,
} from "@/lib/public-pool/quick-entry-customer-service";
import type { QuickEntryBatchClassifiedRow } from "@/lib/public-pool/quick-entry-batch-types";
import {
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerWechat,
} from "@/lib/customers/contact-normalization";

export type BatchClassificationInputRow = {
  rowIndex: number;
  clientRowId: string;
  canonical: QuickEntryCanonicalCustomerFields;
  validation: QuickEntryValidationResult;
};

/**
 * Deterministic in-batch contact duplicate classification.
 * Uses the same normalize keys as checkCustomerDuplicates.
 * Invalid rows do not claim phone/wechat/email winners.
 * Duplicate rows do not register additional contacts into seen maps.
 */
export function classifyQuickEntryBatchRows(
  rows: BatchClassificationInputRow[],
): QuickEntryBatchClassifiedRow[] {
  const ordered = [...rows].sort((a, b) => a.rowIndex - b.rowIndex);
  const phoneWinners = new Map<string, number>();
  const wechatWinners = new Map<string, number>();
  const emailWinners = new Map<string, number>();
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
    const phoneKey = normalizeCustomerPhone(
      canonical.phoneCountryCode,
      canonical.phone,
    );
    const wechatKey = normalizeCustomerWechat(canonical.wechatId);
    const emailKey = normalizeCustomerEmail(canonical.email);

    const phoneHit =
      phoneKey != null ? phoneWinners.get(phoneKey) : undefined;
    const wechatHit =
      wechatKey != null ? wechatWinners.get(wechatKey) : undefined;
    const emailHit =
      emailKey != null ? emailWinners.get(emailKey) : undefined;

    if (phoneHit != null || wechatHit != null || emailHit != null) {
      const duplicateField = pickDuplicateField(phoneHit, wechatHit, emailHit);
      out.push({
        kind: "duplicate",
        rowIndex: row.rowIndex,
        clientRowId: row.clientRowId,
        errorCode:
          duplicateField === "phone"
            ? QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_PHONE
            : duplicateField === "wechatId"
              ? QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_WECHAT
              : QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_EMAIL,
        duplicateField,
      });
      continue;
    }

    if (phoneKey) {
      phoneWinners.set(phoneKey, row.rowIndex);
    }
    if (wechatKey) {
      wechatWinners.set(wechatKey, row.rowIndex);
    }
    if (emailKey) {
      emailWinners.set(emailKey, row.rowIndex);
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
  emailHit: number | undefined,
): "phone" | "wechatId" | "email" {
  const hits: Array<{ field: "phone" | "wechatId" | "email"; index: number }> =
    [];
  if (phoneHit != null) hits.push({ field: "phone", index: phoneHit });
  if (wechatHit != null) hits.push({ field: "wechatId", index: wechatHit });
  if (emailHit != null) hits.push({ field: "email", index: emailHit });
  hits.sort((a, b) => a.index - b.index || a.field.localeCompare(b.field));
  return hits[0]?.field ?? "phone";
}
