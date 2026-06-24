import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { buildCustomerUpdatePayload } from "@/lib/customers/field-change-log";
import { precheckCustomerImport } from "@/lib/import/customers/precheck";
import type {
  CommitResult,
  ImportIssue,
  ParsedImportRow,
} from "@/lib/import/customers/types";
import type { User } from "../../../../drizzle/schema/users";
import type { Database } from "@/lib/db";

type CommitOptions = {
  csvText: string;
  fileName?: string | null;
  skipWarnings?: boolean;
  user: User;
  ipAddress?: string | null;
  userAgent?: string | null;
  jobId?: string | null;
};

function rowHasOnlyWarnings(
  row: ParsedImportRow,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): boolean {
  const hasError = errors.some((e) => e.rowNumber === row.rowNumber);
  if (hasError) return false;
  return warnings.some((w) => w.rowNumber === row.rowNumber);
}

export async function commitCustomerImport(
  options: CommitOptions,
): Promise<CommitResult> {
  const {
    csvText,
    fileName,
    skipWarnings = true,
    user,
    ipAddress,
    userAgent,
    jobId: existingJobId,
  } = options;

  const precheck = await precheckCustomerImport(csvText, user);
  const jobId = existingJobId ?? crypto.randomUUID();
  const db = getDb();
  const now = new Date().toISOString();

  const errorRowNumbers = new Set(precheck.errors.map((e) => e.rowNumber));

  if (precheck.invalidRows > 0 || precheck.errors.length > 0) {
    await upsertImportJob(db, {
      id: jobId,
      status: "failed",
      userId: user.id,
      fileName,
      precheck,
      importedRows: 0,
      completedAt: now,
    });

    await writeAuditLog({
      userId: user.id,
      action: "customers.import.failed",
      entityType: "import_job",
      entityId: jobId,
      ipAddress,
      userAgent,
      metadata: {
        fileName,
        totalRows: precheck.totalRows,
        invalidRows: precheck.invalidRows,
        reason: "precheck_errors",
      },
    });

    return {
      jobId,
      importedCount: 0,
      skippedCount: 0,
      failedCount: precheck.invalidRows,
      createdCustomerIds: [],
      errors: precheck.errors,
      skippedWarnings: [],
    };
  }

  const rowsToImport = precheck.rows.filter((row) => {
    if (errorRowNumbers.has(row.rowNumber)) return false;
    if (skipWarnings && rowHasOnlyWarnings(row, precheck.errors, precheck.warnings)) {
      return false;
    }
    return true;
  });

  const skippedWarnings = skipWarnings
    ? precheck.warnings.filter((w) =>
        rowsToImport.every((r) => r.rowNumber !== w.rowNumber),
      )
    : [];

  const createdCustomerIds: string[] = [];
  const commitErrors: ImportIssue[] = [];

  try {
    for (const row of rowsToImport) {
      const id = crypto.randomUUID();
      const payload = buildCustomerUpdatePayload({
        customerName: row.customerName,
        customerType: row.customerType,
        phoneCountryCode: row.phoneCountryCode,
        phone: row.phone,
        wechatId: row.wechatId,
        email: row.email,
        source: row.source,
        sourceRemark: row.sourceRemark,
        notes: row.notes,
        salesStage: row.salesStage,
        status: "active",
      });

      await db.insert(schema.customers).values({
        id,
        customerName: payload.customerName,
        customerType: payload.customerType,
        phoneCountryCode: payload.phoneCountryCode,
        phone: payload.phone,
        wechatId: payload.wechatId,
        email: payload.email,
        source: payload.source,
        sourceRemark: payload.sourceRemark,
        notes: payload.notes,
        salesStage: payload.salesStage,
        status: "active",
        ownerId: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      });

      createdCustomerIds.push(id);

      await writeAuditLog({
        userId: user.id,
        action: "customer.imported",
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
        metadata: {
          importJobId: jobId,
          rowNumber: row.rowNumber,
          customerName: row.customerName,
          source: row.source,
          ownerId: user.id,
        },
      });
    }

    await upsertImportJob(db, {
      id: jobId,
      status: "completed",
      userId: user.id,
      fileName,
      precheck,
      importedRows: createdCustomerIds.length,
      completedAt: now,
    });

    await writeAuditLog({
      userId: user.id,
      action: "customers.import.completed",
      entityType: "import_job",
      entityId: jobId,
      ipAddress,
      userAgent,
      metadata: {
        fileName,
        totalRows: precheck.totalRows,
        importedCount: createdCustomerIds.length,
        skippedCount: precheck.totalRows - createdCustomerIds.length,
        createdCustomerIds,
      },
    });

    return {
      jobId,
      importedCount: createdCustomerIds.length,
      skippedCount: precheck.totalRows - createdCustomerIds.length,
      failedCount: 0,
      createdCustomerIds,
      errors: commitErrors,
      skippedWarnings,
    };
  } catch (error) {
    await upsertImportJob(db, {
      id: jobId,
      status: "failed",
      userId: user.id,
      fileName,
      precheck,
      importedRows: createdCustomerIds.length,
      completedAt: now,
      errorExtra: String(error),
    });

    await writeAuditLog({
      userId: user.id,
      action: "customers.import.failed",
      entityType: "import_job",
      entityId: jobId,
      ipAddress,
      userAgent,
      metadata: {
        fileName,
        importedBeforeFailure: createdCustomerIds.length,
        error: String(error),
      },
    });

    throw error;
  }
}

async function upsertImportJob(
  db: Database,
  input: {
    id: string;
    status: "prechecked" | "completed" | "failed";
    userId: string;
    fileName?: string | null;
    precheck: Awaited<ReturnType<typeof precheckCustomerImport>>;
    importedRows: number;
    completedAt?: string | null;
    errorExtra?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const summary = {
    errors: input.precheck.errors,
    warnings: input.precheck.warnings,
    duplicateRows: input.precheck.duplicateRows,
    errorExtra: input.errorExtra,
  };

  const existing = await db
    .select({ id: schema.importJobs.id })
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, input.id))
    .limit(1);

  const values = {
    type: "customers" as const,
    status: input.status,
    uploadedBy: input.userId,
    fileName: input.fileName ?? null,
    totalRows: input.precheck.totalRows,
    validRows: input.precheck.validRows,
    invalidRows: input.precheck.invalidRows,
    importedRows: input.importedRows,
    errorSummary: JSON.stringify(summary),
    completedAt: input.completedAt ?? null,
  };

  if (existing.length > 0) {
    await db
      .update(schema.importJobs)
      .set(values)
      .where(eq(schema.importJobs.id, input.id));
  } else {
    await db.insert(schema.importJobs).values({
      id: input.id,
      ...values,
      createdAt: now,
    });
  }
}

export async function createPrecheckImportJob(
  user: User,
  fileName: string | null,
  precheck: Awaited<ReturnType<typeof precheckCustomerImport>>,
): Promise<string> {
  const db = getDb();
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(schema.importJobs).values({
    id: jobId,
    type: "customers",
    status: "prechecked",
    uploadedBy: user.id,
    fileName,
    totalRows: precheck.totalRows,
    validRows: precheck.validRows,
    invalidRows: precheck.invalidRows,
    importedRows: 0,
    errorSummary: JSON.stringify({
      errors: precheck.errors,
      warnings: precheck.warnings,
      duplicateRows: precheck.duplicateRows,
    }),
    createdAt: now,
    completedAt: null,
  });

  return jobId;
}
