import type { AuditLogListItem } from "@/lib/audit/types";

export function formatAuditActorLabel(
  item: Pick<AuditLogListItem, "userName" | "userEmail">,
  systemActorLabel: string,
): string {
  const name = item.userName?.trim() ?? "";
  const email = item.userEmail?.trim() ?? "";

  if (name && email) {
    return `${name} (${email})`;
  }
  if (name) {
    return name;
  }
  if (email) {
    return email;
  }
  return systemActorLabel;
}

export function formatAuditMetadataForDisplay(
  metadata: Record<string, unknown> | null,
): string | null {
  if (!metadata) {
    return null;
  }
  if (Object.keys(metadata).length === 0) {
    return null;
  }
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return null;
  }
}

export function displayAuditField(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

export type AuditLogFilterFormState = {
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  dateFrom: string;
  dateTo: string;
  limit: string;
};

export const DEFAULT_AUDIT_LOG_FILTER_FORM: AuditLogFilterFormState = {
  action: "",
  entityType: "",
  entityId: "",
  userId: "",
  dateFrom: "",
  dateTo: "",
  limit: "50",
};

export function buildAuditLogQueryParams(
  filters: AuditLogFilterFormState,
  cursor?: string | null,
): URLSearchParams {
  const params = new URLSearchParams();
  const entries: Array<[keyof AuditLogFilterFormState, string]> = [
    ["action", filters.action],
    ["entityType", filters.entityType],
    ["entityId", filters.entityId],
    ["userId", filters.userId],
    ["dateFrom", normalizeAuditDateParam(filters.dateFrom)],
    ["dateTo", normalizeAuditDateParam(filters.dateTo)],
    ["limit", filters.limit],
  ];

  for (const [key, value] of entries) {
    const trimmed = value.trim();
    if (trimmed) {
      params.set(key, trimmed);
    }
  }

  if (cursor) {
    params.set("cursor", cursor);
  }

  return params;
}

export function normalizeAuditDateParam(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00.000Z`;
  }
  return trimmed;
}
