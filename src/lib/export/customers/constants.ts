export const EXPORT_SCOPES = [
  "all_active",
  "public_pool",
  "archived",
  "all",
] as const;

export type ExportScope = (typeof EXPORT_SCOPES)[number];

export const EXPORT_SCOPE_LABELS: Record<ExportScope, string> = {
  all_active: "活跃客户（active）",
  public_pool: "公共池客户",
  archived: "归档客户",
  all: "全部客户",
};

export const DEFAULT_EXPORT_FIELDS = [
  "id",
  "customer_name",
  "customer_type",
  "phone_country_code",
  "phone",
  "wechat_id",
  "email",
  "source",
  "source_remark",
  "sales_stage",
  "status",
  "owner_name",
  "created_at",
  "updated_at",
  "last_follow_up_at",
  "last_valid_follow_up_at",
  "next_follow_up_at",
] as const;

export type ExportField = (typeof DEFAULT_EXPORT_FIELDS)[number];

/** Excluded or masked when includeSensitive=false. */
export const SENSITIVE_EXPORT_FIELDS = [
  "phone",
  "wechat_id",
  "email",
  "notes",
  "source_remark",
] as const;

export type SensitiveExportField = (typeof SENSITIVE_EXPORT_FIELDS)[number];

const ALL_EXPORT_FIELDS = [
  ...DEFAULT_EXPORT_FIELDS,
  "notes",
] as const;

export function isExportScope(value: string): value is ExportScope {
  return (EXPORT_SCOPES as readonly string[]).includes(value);
}

export function isExportField(value: string): value is ExportField | "notes" {
  return (ALL_EXPORT_FIELDS as readonly string[]).includes(value);
}

export function parseFieldsParam(raw: string | null): string[] | null {
  if (!raw?.trim()) return null;
  return raw
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function resolveExportFields(
  requested: string[] | null,
  includeSensitive: boolean,
): string[] {
  const base = requested?.length ? requested : [...DEFAULT_EXPORT_FIELDS];
  const valid = base.filter((f) => isExportField(f));
  const unique = [...new Set(valid.length > 0 ? valid : [...DEFAULT_EXPORT_FIELDS])];

  if (includeSensitive) {
    return unique;
  }

  return unique.filter(
    (f) => !(SENSITIVE_EXPORT_FIELDS as readonly string[]).includes(f),
  );
}
