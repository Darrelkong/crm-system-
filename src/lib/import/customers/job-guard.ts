import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ImportJob } from "../../../../drizzle/schema/import-jobs";
import type { User } from "../../../../drizzle/schema/users";
import type { PrecheckResult } from "@/lib/import/customers/types";

export class ImportJobGuardError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "ImportJobGuardError";
  }
}

type StoredJobSummary = {
  errors?: unknown[];
  warnings?: unknown[];
};

function parseJobSummary(raw: string | null): StoredJobSummary {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoredJobSummary;
  } catch {
    return {};
  }
}

/** Validates that an import job can be committed by the current admin. */
export async function assertCommitableImportJob(
  jobId: string,
  user: User,
  precheck: Omit<PrecheckResult, "jobId">,
): Promise<ImportJob> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new ImportJobGuardError(
      "job_not_found",
      "导入任务不存在",
      404,
    );
  }

  if (job.uploadedBy !== user.id) {
    throw new ImportJobGuardError(
      "job_not_owned",
      "无权提交他人的导入任务",
      403,
    );
  }

  if (job.status === "completed") {
    throw new ImportJobGuardError(
      "job_already_completed",
      "该导入任务已完成，不能重复提交",
      409,
    );
  }

  if (job.status === "failed") {
    throw new ImportJobGuardError(
      "job_already_failed",
      "该导入任务已失败，请重新预检后再提交",
      409,
    );
  }

  if (job.status !== "prechecked") {
    throw new ImportJobGuardError(
      "job_invalid_status",
      `导入任务状态无效：${job.status}`,
      400,
    );
  }

  if (job.invalidRows > 0) {
    throw new ImportJobGuardError(
      "job_has_errors",
      "导入任务包含错误行，无法提交",
      400,
    );
  }

  const summary = parseJobSummary(job.errorSummary);
  if (Array.isArray(summary.errors) && summary.errors.length > 0) {
    throw new ImportJobGuardError(
      "job_has_errors",
      "导入任务包含错误行，无法提交",
      400,
    );
  }

  if (precheck.errors.length > 0 || precheck.invalidRows > 0) {
    throw new ImportJobGuardError(
      "precheck_has_errors",
      "当前 CSV 仍存在错误行，无法提交",
      400,
    );
  }

  if (
    precheck.totalRows !== job.totalRows ||
    precheck.validRows !== job.validRows
  ) {
    throw new ImportJobGuardError(
      "precheck_mismatch",
      "CSV 内容与预检时不一致，请重新预检",
      400,
    );
  }

  return job;
}
