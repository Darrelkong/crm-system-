import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getBusinessDateYmd } from "@/lib/reports/dates";
import { buildCustomersExportCsv } from "@/lib/export/customers/csv";
import {
  isExportScope,
  parseFieldsParam,
  resolveExportFields,
  type ExportScope,
} from "@/lib/export/customers/constants";
import { listCustomersForExport } from "@/lib/export/customers/queries";
import type { User } from "../../../../drizzle/schema/users";

export type ExportCustomersParams = {
  scope: ExportScope;
  includeSensitive: boolean;
  fields: string[];
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

  const fields = resolveExportFields(
    parseFieldsParam(searchParams.get("fields")),
    includeSensitive,
  );

  return { scope, includeSensitive, fields };
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
    await db.insert(schema.exportJobs).values({
      id: jobId,
      type: "customers",
      status: "failed",
      exportedBy: user.id,
      scope: params.scope,
      includeSensitive: params.includeSensitive ? 1 : 0,
      fields: params.fields.join(","),
      exportedCount: 0,
      fileName,
      errorMessage: String(error),
      createdAt: now,
      completedAt: now,
    });

    await writeAuditLog({
      userId: user.id,
      action: "customers.export.failed",
      entityType: "export_job",
      entityId: jobId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        scope: params.scope,
        includeSensitive: params.includeSensitive,
        fields: params.fields,
        fileName,
        error: String(error),
      },
    });

    throw error;
  }
}
