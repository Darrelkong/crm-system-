/**
 * Browser-local draft for the new-customer form.
 * Never touches D1 / APIs. Keys are scoped by CRM user.id only.
 */

import type { CustomerNameStatus } from "@/lib/customers/name-status";
import { isPendingNamePlaceholder } from "@/lib/customers/name-status";
import {
  createEmptyCustomerProfileFormFields,
  type CustomerProfileFormFields,
} from "@/lib/customers/customer-profile";

export const CUSTOMER_CREATE_DRAFT_VERSION = 1 as const;
export const CUSTOMER_CREATE_DRAFT_TTL_MS = 72 * 60 * 60 * 1000;
export const CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS = 800;
export const CUSTOMER_CREATE_DRAFT_KEY_PREFIX =
  "crm:customer-create-draft:v1:" as const;
/** Remembers which user last saved a draft so logout can clear safely. */
export const CUSTOMER_CREATE_DRAFT_LAST_USER_KEY =
  "crm:customer-create-draft:v1:lastUserId" as const;

export type CustomerCreateDraftFormData = {
  customerName: string;
  /** confirmed | pending; omitted in legacy drafts → treated as confirmed. */
  nameStatus: CustomerNameStatus;
  requestedProjectCode: string;
  requestedProjectName: string;
  customerType: string;
  phoneCountryCode: string;
  phone: string;
  wechatId: string;
  email: string;
  source: string;
  sourceRemark: string;
  salesStage: string;
  notes: string;
} & CustomerProfileFormFields;

export type CustomerCreateDraftPayload = {
  version: typeof CUSTOMER_CREATE_DRAFT_VERSION;
  userId: string;
  savedAt: number;
  form: CustomerCreateDraftFormData;
};

export type DraftStorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "unavailable" | "invalid" | "expired" | "missing" };

export type CustomerCreateDraftScope =
  | { kind: "standard" }
  | { kind: "family"; sourceCustomerId: string };

function draftKey(
  userId: string,
  scope: CustomerCreateDraftScope = { kind: "standard" },
): string {
  if (scope.kind === "family") {
    return `${CUSTOMER_CREATE_DRAFT_KEY_PREFIX}family:${scope.sourceCustomerId}:${userId}`;
  }
  return `${CUSTOMER_CREATE_DRAFT_KEY_PREFIX}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function createEmptyCustomerCreateFormData(): CustomerCreateDraftFormData {
  return {
    customerName: "",
    nameStatus: "confirmed",
    requestedProjectCode: "",
    requestedProjectName: "",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "",
    wechatId: "",
    email: "",
    source: "",
    sourceRemark: "",
    salesStage: "new_lead",
    notes: "",
    ...createEmptyCustomerProfileFormFields(),
  };
}

/** True when the draft has user-entered content beyond blank defaults. */
export function isCustomerCreateDraftMeaningful(
  form: CustomerCreateDraftFormData,
): boolean {
  const empty = createEmptyCustomerCreateFormData();
  return (Object.keys(empty) as Array<keyof CustomerCreateDraftFormData>).some(
    (key) => form[key].trim() !== empty[key].trim(),
  );
}

export function parseCustomerCreateDraftPayload(
  raw: unknown,
  expectedUserId: string,
  nowMs: number = Date.now(),
): DraftStorageResult<CustomerCreateDraftPayload> {
  if (!isRecord(raw)) {
    return { ok: false, reason: "invalid" };
  }

  if (raw.version !== CUSTOMER_CREATE_DRAFT_VERSION) {
    return { ok: false, reason: "invalid" };
  }

  const userId = readString(raw.userId);
  if (!userId || userId !== expectedUserId) {
    return { ok: false, reason: "invalid" };
  }

  const savedAt = raw.savedAt;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) {
    return { ok: false, reason: "invalid" };
  }

  if (nowMs - savedAt > CUSTOMER_CREATE_DRAFT_TTL_MS) {
    return { ok: false, reason: "expired" };
  }

  if (!isRecord(raw.form)) {
    return { ok: false, reason: "invalid" };
  }

  const form = normalizeCustomerCreateDraftForm(raw.form);

  return {
    ok: true,
    value: {
      version: CUSTOMER_CREATE_DRAFT_VERSION,
      userId,
      savedAt,
      form,
    },
  };
}

/** Legacy drafts without profile / nameStatus default safely. */
export function normalizeCustomerCreateDraftForm(
  form: Record<string, unknown>,
): CustomerCreateDraftFormData {
  const customerName = readString(form.customerName);
  const rawStatus = readString(form.nameStatus, "confirmed");

  let nameStatus: CustomerNameStatus = "confirmed";
  let resolvedName = customerName;

  if (rawStatus === "pending" && isPendingNamePlaceholder(customerName)) {
    nameStatus = "pending";
  } else if (rawStatus === "pending") {
    // Illegal pending placeholder → safe confirmed blank name.
    resolvedName = "";
  }

  return {
    customerName: resolvedName,
    nameStatus,
    requestedProjectCode: readString(form.requestedProjectCode),
    requestedProjectName: readString(form.requestedProjectName),
    customerType: readString(form.customerType, "individual"),
    phoneCountryCode: readString(form.phoneCountryCode, "+86"),
    phone: readString(form.phone),
    wechatId: readString(form.wechatId),
    email: readString(form.email),
    source: readString(form.source),
    sourceRemark: readString(form.sourceRemark),
    salesStage: readString(form.salesStage, "new_lead"),
    notes: readString(form.notes),
    preferredName: readString(form.preferredName),
    gender: readString(form.gender),
    ageRange: readString(form.ageRange),
    preferredLanguage: readString(form.preferredLanguage),
    preferredContactMethod: readString(form.preferredContactMethod),
    occupation: readString(form.occupation),
    companyName: readString(form.companyName),
    jobTitle: readString(form.jobTitle),
    targetCountryOrRegion: readString(form.targetCountryOrRegion),
    primaryConcern: readString(form.primaryConcern),
  };
}

export function buildCustomerCreateDraftPayload(
  userId: string,
  form: CustomerCreateDraftFormData,
  savedAt: number = Date.now(),
): CustomerCreateDraftPayload {
  return {
    version: CUSTOMER_CREATE_DRAFT_VERSION,
    userId,
    savedAt,
    form: { ...form },
  };
}

export function saveCustomerCreateDraft(
  userId: string,
  form: CustomerCreateDraftFormData,
  savedAt: number = Date.now(),
  scope: CustomerCreateDraftScope = { kind: "standard" },
): DraftStorageResult<CustomerCreateDraftPayload | null> {
  if (typeof localStorage === "undefined") {
    return { ok: false, reason: "unavailable" };
  }

  if (!isCustomerCreateDraftMeaningful(form)) {
    clearCustomerCreateDraft(userId, scope);
    return { ok: true, value: null };
  }

  const payload = buildCustomerCreateDraftPayload(userId, form, savedAt);

  try {
    localStorage.setItem(draftKey(userId, scope), JSON.stringify(payload));
    localStorage.setItem(CUSTOMER_CREATE_DRAFT_LAST_USER_KEY, userId);
    return { ok: true, value: payload };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function loadCustomerCreateDraft(
  userId: string,
  nowMs: number = Date.now(),
  scope: CustomerCreateDraftScope = { kind: "standard" },
): DraftStorageResult<CustomerCreateDraftPayload> {
  if (typeof localStorage === "undefined") {
    return { ok: false, reason: "unavailable" };
  }

  let rawText: string | null;
  try {
    rawText = localStorage.getItem(draftKey(userId, scope));
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (rawText == null || rawText === "") {
    return { ok: false, reason: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    try {
      localStorage.removeItem(draftKey(userId, scope));
    } catch {
      // ignore
    }
    return { ok: false, reason: "invalid" };
  }

  const result = parseCustomerCreateDraftPayload(parsed, userId, nowMs);
  if (!result.ok) {
    if (result.reason === "expired" || result.reason === "invalid") {
      clearCustomerCreateDraft(userId, scope);
    }
    return result;
  }

  return result;
}

/** Clears only the draft for the given userId. Never wipes all localStorage. */
export function clearCustomerCreateDraft(
  userId: string,
  scope: CustomerCreateDraftScope = { kind: "standard" },
): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.removeItem(draftKey(userId, scope));
  } catch {
    // ignore
  }

  try {
    const last = localStorage.getItem(CUSTOMER_CREATE_DRAFT_LAST_USER_KEY);
    if (last === userId) {
      localStorage.removeItem(CUSTOMER_CREATE_DRAFT_LAST_USER_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Best-effort logout cleanup: clears the draft for the last user who saved one.
 * Does not clear other users' drafts on the same device.
 */
export function clearCustomerCreateDraftForLastUser(): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    const last = localStorage.getItem(CUSTOMER_CREATE_DRAFT_LAST_USER_KEY);
    if (last) {
      clearCustomerCreateDraft(last);
    }
  } catch {
    // ignore
  }
}

export function formatDraftSavedClock(savedAtMs: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Hong_Kong",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(savedAtMs));

    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const second = parts.find((p) => p.type === "second")?.value ?? "00";
    return `${hour}:${minute}:${second}`;
  } catch {
    const d = new Date(savedAtMs);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}
