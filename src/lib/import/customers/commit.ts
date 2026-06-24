import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { buildCustomerUpdatePayload } from "@/lib/customers/field-change-log";
import {
  assertCommitableImportJob,
  ImportJobGuardError,
} from "@/lib/import/customers/job-guard";
import { precheckCustomerImport } from "@/lib/import/customers/precheck";
import type { CommitResult } from "@/lib/import/customers/types";
import type { User } from "../../../../drizzle/schema/users";
import type { Database } from "@/lib/db";

type CommitOptions = {
  csvText: string;
  fileName?: string | null;
  user: User;
  ipAddress?: string | null;
  userAgent?: string | null;
  jobId: string;
};

export async function commitCustomerImport(
  options: CommitOptions,
): Promise<CommitResult> {
  const { csvText, fileName, user, ipAddress, userAgent, jobId } = options;

  const precheck = await precheckCustomerImport(csvText, user);
  const db = getDb();
  const now = new Date().toISOString();

  try {
    await assertCommitableImportJob(jobId, user, precheck);
  } catch (error) {
    if (error instanceof ImportJobGuardError) {
      const updatable =
        error.code === "precheck_has_errors" ||
        error.code === "precheck_mismatch" ||
        error.code === "job_has_errors";

      if (updatable) {
        await markImportJobFailed(db, {
          jobId,
          userId: user.id,
          fileName,
          precheck,
          reason: error.code,
          completedAt: now,
        });
      }

      await writeAuditLog({
        userId: user.id,
        action: "customers.import.failed",
        entityType: "import_job",
        entityId: jobId,
        ipAddress,
        userAgent,
        metadata: {
          fileName,
          reason: error.code,
          message: error.message,
        },
      });

      throw error;
    }
    throw error;
  }

  const errorRowNumbers = new Set(precheck.errors.map((e) => e.rowNumber));

  const rowsToImport = precheck.rows.filter(
    (row) => !errorRowNumbers.has(row.rowNumber),
  );

  const createdCustomerIds: string[] = [];

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

    await updateImportJob(db, {
      id: jobId,
      status: "completed",
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
        warningCount: precheck.warnings.length,
        createdCustomerIds,
      },
    });

    return {
      jobId,
      importedCount: createdCustomerIds.length,
      skippedCount: 0,
      failedCount: 0,
      createdCustomerIds,
      errors: [],
      warnings: precheck.warnings,
    };
  } catch (error) {
    if (!(error instanceof ImportJobGuardError)) {
      await markImportJobFailed(db, {
        jobId,
        userId: user.id,
        fileName,
        precheck,
        reason: "commit_exception",
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
    }

    throw error;
  }
}

async function updateImportJob(
  db: Database,
  input: {
    id: string;
    status: "completed";
    precheck: Awaited<ReturnType<typeof precheckCustomerImport>>;
    importedRows: number;
    completedAt: string;
  },
): Promise<void> {
  const summary = {
    errors: input.precheck.errors,
    warnings: input.precheck.warnings,
    duplicateRows: input.precheck.duplicateRows,
  };

  await db
    .update(schema.importJobs)
    .set({
      status: input.status,
      totalRows: input.precheck.totalRows,
      validRows: input.precheck.validRows,
      invalidRows: input.precheck.invalidRows,
      importedRows: input.importedRows,
      errorSummary: JSON.stringify(summary),
      completedAt: input.completedAt,
    })
    .where(eq(schema.importJobs.id, input.id));
}

async function markImportJobFailed(
  db: Database,
  input: {
    jobId: string;
    userId: string;
    fileName?: string | null;
    precheck: Awaited<ReturnType<typeof precheckCustomerImport>>;
    reason: string;
    completedAt: string;
    errorExtra?: string;
  },
): Promise<void> {
  const summary = {
    errors: input.precheck.errors,
    warnings: input.precheck.warnings,
    duplicateRows: input.precheck.duplicateRows,
    reason: input.reason,
    errorExtra: input.errorExtra,
  };

  await db
    .update(schema.importJobs)
    .set({
      status: "failed",
      fileName: input.fileName ?? null,
      totalRows: input.precheck.totalRows,
      validRows: input.precheck.validRows,
      invalidRows: input.precheck.invalidRows,
      importedRows: 0,
      errorSummary: JSON.stringify(summary),
      completedAt: input.completedAt,
    })
    .where(eq(schema.importJobs.id, input.jobId));
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
