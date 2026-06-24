import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getBusinessDateYmd } from "@/lib/reports/dates";
import { buildCustomersExportCsv } from "@/lib/export/customers/csv";
import {
  applySensitiveFieldPolicy,
  computeExportRiskLevel,
  isExportScope,
  parseFieldsParam,
  validateRequestedExportFields,
  type ExportRiskLevel,
  type ExportScope,
} from "@/lib/export/customers/constants";
import { listCustomersForExport } from "@/lib/export/customers/queries";
import type { User } from "../../../../drizzle/schema/users";

export type ExportCustomersParams = {
  scope: ExportScope;
  includeSensitive: boolean;
  fields: string[];
  riskLevel: ExportRiskLevel;
};

export type ExportCustomersResult = {
  csv: string;
  fileName: string;
  exportedCount: number;
  jobId: string;
  params: ExportCustomersParams;
};

export function parseExportCustomersQuery(
  searchParams: URLSearchParams,
): ExportCustomersParams {
  const scopeRaw = searchParams.get("scope") ?? "all_active";
  const scope = isExportScope(scopeRaw) ? scopeRaw : "all_active";

  const includeSensitiveParam = searchParams.get("includeSensitive");
  const includeSensitive =
    includeSensitiveParam === null || includeSensitiveParam === ""
      ? true
      : includeSensitiveParam === "true";

  const validatedFields = validateRequestedExportFields(
    parseFieldsParam(searchParams.get("fields")),
  );
  const fields = applySensitiveFieldPolicy(validatedFields, includeSensitive);
  const riskLevel = computeExportRiskLevel(scope, includeSensitive);

  return { scope, includeSensitive, fields, riskLevel };
}

async function recordExportFailure(
  user: User,
  input: {
    jobId: string;
    params: Pick<
      ExportCustomersParams,
      "scope" | "includeSensitive" | "fields" | "riskLevel"
    >;
    fileName: string;
    now: string;
    reason: string;
    invalidFields?: string[];
    error?: string;
    meta: { ipAddress?: string | null; userAgent?: string | null };
  },
): Promise<void> {
  const db = getDb();
  const errorMessage = input.invalidFields?.length
    ? `${input.reason}: ${input.invalidFields.join(", ")}`
    : input.error ?? input.reason;

  await db.insert(schema.exportJobs).values({
    id: input.jobId,
    type: "customers",
    status: "failed",
    exportedBy: user.id,
    scope: input.params.scope,
    includeSensitive: input.params.includeSensitive ? 1 : 0,
    fields: input.params.fields.join(","),
    exportedCount: 0,
    fileName: input.fileName,
    errorMessage,
    createdAt: input.now,
    completedAt: input.now,
  });

  await writeAuditLog({
    userId: user.id,
    action: "customers.export.failed",
    entityType: "export_job",
    entityId: input.jobId,
    ipAddress: input.meta.ipAddress,
    userAgent: input.meta.userAgent,
    metadata: {
      scope: input.params.scope,
      includeSensitive: input.params.includeSensitive,
      fields: input.params.fields,
      fileName: input.fileName,
      riskLevel: input.params.riskLevel,
      reason: input.reason,
      invalidFields: input.invalidFields,
      error: input.error,
    },
  });
}

export async function exportCustomersCsv(
  user: User,
  params: ExportCustomersParams,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<ExportCustomersResult> {
  const db = getDb();
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const dateYmd = getBusinessDateYmd();
  const fileName = `customers-export-${dateYmd}.csv`;

  try {
    const rows = await listCustomersForExport(params.scope);
    const csv = buildCustomersExportCsv(rows, params.fields);
    const exportedCount = rows.length;

    await db.insert(schema.exportJobs).values({
      id: jobId,
      type: "customers",
      status: "completed",
      exportedBy: user.id,
      scope: params.scope,
      includeSensitive: params.includeSensitive ? 1 : 0,
      fields: params.fields.join(","),
      exportedCount,
      fileName,
      errorMessage: null,
      createdAt: now,
      completedAt: now,
    });

    await writeAuditLog({
      userId: user.id,
      action: "customers.exported",
      entityType: "export_job",
      entityId: jobId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        actorUserId: user.id,
        scope: params.scope,
        includeSensitive: params.includeSensitive,
        fields: params.fields,
        exportedCount,
        fileName,
        riskLevel: params.riskLevel,
        createdAt: now,
      },
    });

    return {
      csv,
      fileName,
      exportedCount,
      jobId,
      params,
    };
  } catch (error) {
    await recordExportFailure(user, {
      jobId,
      params,
      fileName,
      now,
      reason: "export_exception",
      error: String(error),
      meta,
    });

    throw error;
  }
}

export async function recordInvalidExportFieldsFailure(
  user: User,
  input: {
    scope: ExportScope;
    includeSensitive: boolean;
    invalidFields: string[];
    requestedFields: string[];
    meta: { ipAddress?: string | null; userAgent?: string | null };
  },
): Promise<void> {
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const dateYmd = getBusinessDateYmd();
  const fileName = `customers-export-${dateYmd}.csv`;
  const riskLevel = computeExportRiskLevel(
    input.scope,
    input.includeSensitive,
  );

  await recordExportFailure(user, {
    jobId,
    params: {
      scope: input.scope,
      includeSensitive: input.includeSensitive,
      fields: input.requestedFields,
      riskLevel,
    },
    fileName,
    now,
    reason: "invalid_export_field",
    invalidFields: input.invalidFields,
    meta: input.meta,
  });
}
