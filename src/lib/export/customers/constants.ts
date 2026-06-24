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

/** Explicit whitelist — only these fields may appear in exports. */
export const ALLOWED_EXPORT_FIELDS = [
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
  "notes",
] as const;

export type AllowedExportField = (typeof ALLOWED_EXPORT_FIELDS)[number];

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
] as const satisfies readonly AllowedExportField[];

/** Excluded when includeSensitive=false (cannot be bypassed via fields param). */
export const SENSITIVE_EXPORT_FIELDS = [
  "phone",
  "wechat_id",
  "email",
  "notes",
  "source_remark",
] as const;

export type SensitiveExportField = (typeof SENSITIVE_EXPORT_FIELDS)[number];

export type ExportRiskLevel = "low" | "medium" | "high";

export class ExportValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly invalidFields: string[] = [],
  ) {
    super(message);
    this.name = "ExportValidationError";
  }
}

export function isExportScope(value: string): value is ExportScope {
  return (EXPORT_SCOPES as readonly string[]).includes(value);
}

export function isAllowedExportField(
  value: string,
): value is AllowedExportField {
  return (ALLOWED_EXPORT_FIELDS as readonly string[]).includes(value);
}

export function parseFieldsParam(raw: string | null): string[] | null {
  if (!raw?.trim()) return null;
  return raw
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function validateRequestedExportFields(
  requested: string[] | null,
): string[] {
  const fields = requested?.length ? requested : [...DEFAULT_EXPORT_FIELDS];
  const invalidFields = fields.filter((f) => !isAllowedExportField(f));

  if (invalidFields.length > 0) {
    throw new ExportValidationError(
      "invalid_export_field",
      `不允许的导出字段：${invalidFields.join(", ")}`,
      invalidFields,
    );
  }

  return [...new Set(fields)];
}

/** Strip sensitive columns when includeSensitive=false. */
export function applySensitiveFieldPolicy(
  fields: string[],
  includeSensitive: boolean,
): string[] {
  if (includeSensitive) {
    return fields;
  }

  return fields.filter(
    (f) => !(SENSITIVE_EXPORT_FIELDS as readonly string[]).includes(f),
  );
}

export function computeExportRiskLevel(
  scope: ExportScope,
  includeSensitive: boolean,
): ExportRiskLevel {
  if (includeSensitive) return "high";
  if (scope === "all" || scope === "archived") return "medium";
  return "low";
}

export function requiresExportRiskConfirmation(
  scope: ExportScope,
  includeSensitive: boolean,
): boolean {
  return includeSensitive || scope === "all" || scope === "archived";
}

export const EXPORT_RISK_CONFIRMATION_MESSAGE =
  "你正在导出包含敏感客户资料的数据。请确认该导出仅用于公司内部授权用途，并妥善保存文件。";
