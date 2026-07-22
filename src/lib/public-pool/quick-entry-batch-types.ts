import type { QuickEntryCanonicalCustomerFields } from "@/lib/public-pool/quick-entry-customer-validation";
import type { QuickEntryDuplicateField } from "../../../drizzle/schema/public-pool-quick-entry-submissions";

/**
 * Typed Batch Domain row input (Route JSON parsing is 3C).
 * Must not include submissionDbId / ownerId / status / source / sessionId.
 */
export type QuickEntryBatchCustomerRowInput = {
  clientRowId: string;
  customerName: string;
  phone?: string | null;
  phoneCountryCode?: string | null;
  wechatId?: string | null;
  requestedProjectName: string;
  initialFollowUpNote?: string | null;
  supplementalNote?: string | null;
};

export type QuickEntryBatchCanonicalRow = QuickEntryCanonicalCustomerFields & {
  clientRowId: string;
};

export type QuickEntryBatchRowResultCreated = {
  clientRowId: string;
  status: "created";
  customerId: string;
  customerCode: string;
  customerName: string;
};

export type QuickEntryBatchRowResultDuplicate = {
  clientRowId: string;
  status: "duplicate";
  errorCode: string;
  duplicateField: QuickEntryDuplicateField;
};

export type QuickEntryBatchRowResultInvalid = {
  clientRowId: string;
  status: "invalid";
  errorCode: string;
};

export type QuickEntryBatchRowResultFailed = {
  clientRowId: string;
  status: "failed";
  errorCode: string;
};

export type QuickEntryBatchRowResult =
  | QuickEntryBatchRowResultCreated
  | QuickEntryBatchRowResultDuplicate
  | QuickEntryBatchRowResultInvalid
  | QuickEntryBatchRowResultFailed;

export type QuickEntryBatchSummary = {
  total: number;
  created: number;
  duplicates: number;
  invalid: number;
  failed: number;
};

export type QuickEntryBatchSuccess = {
  ok: true;
  submissionId: string;
  replayed: boolean;
  summary: QuickEntryBatchSummary;
  results: QuickEntryBatchRowResult[];
};

export type QuickEntryBatchFailure = {
  ok: false;
  errorCode: string;
  message: string;
  retryAfterSeconds?: number;
};

export type QuickEntryBatchResult = QuickEntryBatchSuccess | QuickEntryBatchFailure;

export type QuickEntryBatchClassifiedEligible = {
  kind: "eligible";
  rowIndex: number;
  clientRowId: string;
  normalizedCustomer: QuickEntryCanonicalCustomerFields;
};

export type QuickEntryBatchClassifiedInvalid = {
  kind: "invalid";
  rowIndex: number;
  clientRowId: string;
  errorCode: string;
};

export type QuickEntryBatchClassifiedDuplicate = {
  kind: "duplicate";
  rowIndex: number;
  clientRowId: string;
  errorCode: string;
  duplicateField: QuickEntryDuplicateField;
};

export type QuickEntryBatchClassifiedRow =
  | QuickEntryBatchClassifiedEligible
  | QuickEntryBatchClassifiedInvalid
  | QuickEntryBatchClassifiedDuplicate;
