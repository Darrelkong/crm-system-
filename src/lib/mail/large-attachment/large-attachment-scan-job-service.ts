import {
  and,
  asc,
  eq,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import {
  assertBatchUpdateChanged,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import {
  getLargeAttachmentScanRetryDecision,
} from "./large-attachment-malware-scan-retry";
import {
  applyLargeAttachmentMalwareScanResult,
  TERMINAL_LARGE_ATTACHMENT_LIFECYCLE_STATUSES,
} from "./large-attachment-malware-scan-state";
import {
  processLargeAttachmentMalwareScanJob,
  type LargeAttachmentMalwareScanProcessResult,
  type R2ScanBucket,
} from "./large-attachment-malware-scan-service";
import type {
  LargeAttachmentMalwareScanResult,
  LargeAttachmentMalwareScanner,
  LargeAttachmentScanStorageIdentity,
} from "./large-attachment-malware-scanner";
import type {
  MailLargeAttachmentScanJob,
  NewMailLargeAttachmentScanJob,
} from "../../../../drizzle/schema/mail-large-attachment-scan-jobs";

export const LARGE_ATTACHMENT_SCAN_POLL_DELAY_MS = 5_000;
export const LARGE_ATTACHMENT_SCAN_PROCESSING_LEASE_MS = 60_000;

export type LargeAttachmentScanJobProcessingDeps = {
  bucket: R2ScanBucket;
  scanner: LargeAttachmentMalwareScanner;
};

type ScanJobInsertInput = {
  id: string;
  lifecycleId: string;
  storedFileId: string;
  provider: string;
  storageKey: string;
  storageEtag: string;
  storageVersion: string | null;
  declaredContentHash: string;
  now: string;
};

export function buildLargeAttachmentScanJobInsert(
  input: ScanJobInsertInput,
): NewMailLargeAttachmentScanJob {
  return {
    id: input.id,
    lifecycleId: input.lifecycleId,
    storedFileId: input.storedFileId,
    provider: input.provider,
    providerJobId: null,
    jobStatus: "queued",
    storageKey: input.storageKey,
    storageEtag: input.storageEtag,
    storageVersion: input.storageVersion,
    declaredContentHash: input.declaredContentHash,
    providerContentHash: null,
    attemptCount: 0,
    nextAttemptAt: input.now,
    submittedAt: null,
    completedAt: null,
    lastErrorCode: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export async function findLargeAttachmentScanJobById(
  db: Database,
  jobId: string,
): Promise<MailLargeAttachmentScanJob | null> {
  const [job] = await db
    .select()
    .from(schema.mailLargeAttachmentScanJobs)
    .where(eq(schema.mailLargeAttachmentScanJobs.id, jobId))
    .limit(1);
  return job ?? null;
}

export async function findLargeAttachmentScanJobByLifecycleId(
  db: Database,
  lifecycleId: string,
): Promise<MailLargeAttachmentScanJob | null> {
  const [job] = await db
    .select()
    .from(schema.mailLargeAttachmentScanJobs)
    .where(eq(schema.mailLargeAttachmentScanJobs.lifecycleId, lifecycleId))
    .limit(1);
  return job ?? null;
}

export async function createLargeAttachmentScanJob(
  db: Database,
  input: ScanJobInsertInput,
): Promise<{ job: MailLargeAttachmentScanJob; created: boolean }> {
  const existing = await findLargeAttachmentScanJobByLifecycleId(
    db,
    input.lifecycleId,
  );
  if (existing) {
    if (
      existing.storedFileId !== input.storedFileId ||
      existing.storageKey !== input.storageKey ||
      existing.storageEtag !== input.storageEtag ||
      existing.storageVersion !== input.storageVersion
    ) {
      throw new Error("Large attachment scan job identity conflict");
    }
    return { job: existing, created: false };
  }

  const values = buildLargeAttachmentScanJobInsert(input);
  try {
    await db.insert(schema.mailLargeAttachmentScanJobs).values(values);
  } catch (error) {
    if (!/UNIQUE constraint failed/i.test(error instanceof Error ? error.message : "")) {
      throw error;
    }
  }
  const job = await findLargeAttachmentScanJobByLifecycleId(db, input.lifecycleId);
  if (!job) {
    throw new Error("Large attachment scan job insert failed");
  }
  return { job, created: job.id === input.id };
}

function dueJobPredicate(trustNow: string) {
  return or(
    isNull(schema.mailLargeAttachmentScanJobs.nextAttemptAt),
    lte(schema.mailLargeAttachmentScanJobs.nextAttemptAt, trustNow),
  );
}

export async function listDueLargeAttachmentScanJobs(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<MailLargeAttachmentScanJob[]> {
  return db
    .select()
    .from(schema.mailLargeAttachmentScanJobs)
    .where(
      and(
        dueJobPredicate(input.trustNow),
        or(
          eq(schema.mailLargeAttachmentScanJobs.jobStatus, "queued"),
          eq(schema.mailLargeAttachmentScanJobs.jobStatus, "retry_wait"),
          eq(schema.mailLargeAttachmentScanJobs.jobStatus, "submitted"),
          eq(schema.mailLargeAttachmentScanJobs.jobStatus, "polling"),
        ),
      ),
    )
    .orderBy(
      asc(
        sql`coalesce(${schema.mailLargeAttachmentScanJobs.nextAttemptAt}, ${schema.mailLargeAttachmentScanJobs.createdAt})`,
      ),
      asc(schema.mailLargeAttachmentScanJobs.id),
    )
    .limit(input.limit);
}

export async function claimLargeAttachmentScanJob(
  db: Database,
  input: { jobId: string; trustNow: string },
): Promise<MailLargeAttachmentScanJob | null> {
  const job = await findLargeAttachmentScanJobById(db, input.jobId);
  if (!job) return null;
  const eligible =
    ["queued", "retry_wait", "submitted", "polling"].includes(job.jobStatus) &&
    (job.nextAttemptAt === null || job.nextAttemptAt <= input.trustNow);
  if (!eligible) return null;

  const leaseUntil = new Date(
    Date.parse(input.trustNow) + LARGE_ATTACHMENT_SCAN_PROCESSING_LEASE_MS,
  ).toISOString();
  const result = await db
    .update(schema.mailLargeAttachmentScanJobs)
    .set({
      jobStatus: "polling",
      nextAttemptAt: leaseUntil,
      updatedAt: input.trustNow,
    })
    .where(
      and(
        eq(schema.mailLargeAttachmentScanJobs.id, job.id),
        eq(schema.mailLargeAttachmentScanJobs.jobStatus, job.jobStatus),
        or(
          isNull(schema.mailLargeAttachmentScanJobs.nextAttemptAt),
          lte(schema.mailLargeAttachmentScanJobs.nextAttemptAt, input.trustNow),
        ),
      ),
    );
  if ((result.meta?.changes ?? 0) !== 1) return null;
  return findLargeAttachmentScanJobById(db, job.id);
}

export type LoadedLargeAttachmentScanContext = {
  job: MailLargeAttachmentScanJob;
  lifecycle: {
    status: string;
    storageEtag: string | null;
    storageVersion: string | null;
  };
  storedFile: {
    id: string;
    contentHash: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
    securityScanStatus: "unscanned" | "clean" | "blocked" | "scan_failed";
  };
};

async function loadScanContext(
  db: Database,
  jobId: string,
): Promise<LoadedLargeAttachmentScanContext | null> {
  const [row] = await db
    .select({
      job: schema.mailLargeAttachmentScanJobs,
      lifecycle: {
        status: schema.mailLargeAttachmentLifecycle.status,
        storageEtag: schema.mailLargeAttachmentLifecycle.storageEtag,
        storageVersion: schema.mailLargeAttachmentLifecycle.storageVersion,
      },
      storedFile: {
        id: schema.mailStoredFiles.id,
        contentHash: schema.mailStoredFiles.contentHash,
        originalFilename: schema.mailStoredFiles.originalFilename,
        mimeType: schema.mailStoredFiles.mimeType,
        sizeBytes: schema.mailStoredFiles.sizeBytes,
        storageKey: schema.mailStoredFiles.storageKey,
        securityScanStatus: schema.mailStoredFiles.securityScanStatus,
      },
    })
    .from(schema.mailLargeAttachmentScanJobs)
    .innerJoin(
      schema.mailLargeAttachmentLifecycle,
      eq(
        schema.mailLargeAttachmentLifecycle.id,
        schema.mailLargeAttachmentScanJobs.lifecycleId,
      ),
    )
    .innerJoin(
      schema.mailStoredFiles,
      eq(
        schema.mailStoredFiles.id,
        schema.mailLargeAttachmentScanJobs.storedFileId,
      ),
    )
    .where(eq(schema.mailLargeAttachmentScanJobs.id, jobId))
    .limit(1);
  return row ?? null;
}

function storageIdentityForJob(
  job: MailLargeAttachmentScanJob,
  sizeBytes: number,
): LargeAttachmentScanStorageIdentity {
  return {
    storageKey: job.storageKey,
    sizeBytes,
    storageEtag: job.storageEtag,
    storageVersion: job.storageVersion,
  };
}

function statusForCompletedResult(
  result: LargeAttachmentMalwareScanResult,
): "clean" | "blocked" | "scan_failed" {
  if (
    result.status !== "clean" &&
    result.status !== "blocked" &&
    result.status !== "scan_failed"
  ) {
    throw new Error("Pending scan result cannot complete a scan job");
  }
  return result.status;
}

export async function recordLargeAttachmentScanProviderSubmission(
  db: Database,
  job: MailLargeAttachmentScanJob,
  result: {
    providerJobId: string;
    providerObservedSha256: string | null;
  },
  now: string,
): Promise<void> {
  const nextAttemptAt = new Date(
    Date.parse(now) + LARGE_ATTACHMENT_SCAN_POLL_DELAY_MS,
  ).toISOString();
  const results = await runMailBatch(db, [
    db
      .update(schema.mailLargeAttachmentScanJobs)
      .set({
        jobStatus: "submitted",
        providerJobId: result.providerJobId,
        providerContentHash: result.providerObservedSha256,
        submittedAt: job.submittedAt ?? now,
        nextAttemptAt,
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailLargeAttachmentScanJobs.id, job.id),
          eq(schema.mailLargeAttachmentScanJobs.jobStatus, "polling"),
        ),
      ),
  ]);
  assertBatchUpdateChanged(results, 0, "Scan submission CAS failed");
}

export const recordLargeAttachmentScanPollingState =
  recordLargeAttachmentScanProviderSubmission;

async function cancelTerminalScanJob(
  db: Database,
  job: MailLargeAttachmentScanJob,
  now: string,
): Promise<void> {
  await db
    .update(schema.mailLargeAttachmentScanJobs)
    .set({
      jobStatus: "cancelled",
      nextAttemptAt: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.mailLargeAttachmentScanJobs.id, job.id),
        eq(schema.mailLargeAttachmentScanJobs.jobStatus, "polling"),
      ),
    );
}

export async function scheduleLargeAttachmentScanRetryOrFail(
  db: Database,
  context: LoadedLargeAttachmentScanContext,
  result: LargeAttachmentMalwareScanResult,
  now: string,
): Promise<void> {
  const nextAttemptCount = context.job.attemptCount + 1;
  const retry = getLargeAttachmentScanRetryDecision({
    attemptCount: nextAttemptCount,
    retryable: result.retryable === true,
  });
  if (retry.retry) {
    const nextAttemptAt = new Date(
      Date.parse(now) + retry.nextAttemptDelayMs!,
    ).toISOString();
    await db
      .update(schema.mailLargeAttachmentScanJobs)
      .set({
        jobStatus: "retry_wait",
        attemptCount: nextAttemptCount,
        nextAttemptAt,
        lastErrorCode: result.failureCode ?? "UNKNOWN",
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailLargeAttachmentScanJobs.id, context.job.id),
          eq(schema.mailLargeAttachmentScanJobs.jobStatus, "polling"),
        ),
      );
    return;
  }

  await completeLargeAttachmentScanWithStatus(db, context, "scan_failed", {
    status: "scan_failed",
    providerObservedSha256: result.providerObservedSha256,
    failureCode: result.failureCode ?? "UNKNOWN",
    retryable: false,
  }, now, nextAttemptCount);
}

export async function completeLargeAttachmentScanWithStatus(
  db: Database,
  context: LoadedLargeAttachmentScanContext,
  status: "clean" | "blocked" | "scan_failed",
  result: LargeAttachmentMalwareScanResult,
  now: string,
  attemptCount = context.job.attemptCount,
): Promise<void> {
  const currentStorage = {
    storageKey: context.storedFile.storageKey,
    sizeBytes: context.storedFile.sizeBytes,
    storageEtag: context.lifecycle.storageEtag ?? "",
    storageVersion: context.lifecycle.storageVersion,
  };
  const resultStorage = storageIdentityForJob(
    context.job,
    context.storedFile.sizeBytes,
  );
  const applied = applyLargeAttachmentMalwareScanResult({
    currentStatus: context.storedFile.securityScanStatus,
    lifecycleStatus: context.lifecycle.status,
    currentStorage,
    resultStorage,
    result: { ...result, status },
  });
  if (!applied.applied && applied.reason === "TERMINAL_LIFECYCLE") {
    await cancelTerminalScanJob(db, context.job, now);
    return;
  }
  if (!applied.applied && applied.reason === "BLOCKED_IS_TERMINAL") {
    await db
      .update(schema.mailLargeAttachmentScanJobs)
      .set({
        jobStatus: "failed",
        nextAttemptAt: null,
        completedAt: now,
        lastErrorCode: "BLOCKED_IS_TERMINAL",
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailLargeAttachmentScanJobs.id, context.job.id),
          eq(schema.mailLargeAttachmentScanJobs.jobStatus, "polling"),
        ),
      );
    return;
  }
  if (applied.status !== status && status === "clean") {
    await scheduleLargeAttachmentScanRetryOrFail(
      db,
      context,
      {
        status: "scan_failed",
        providerObservedSha256: result.providerObservedSha256,
        failureCode: "STORAGE_IDENTITY_MISMATCH",
        retryable: false,
      },
      now,
    );
    return;
  }

  const terminalJobStatus = status === "scan_failed" ? "failed" : "completed";
  const statements = [
    db
      .update(schema.mailLargeAttachmentScanJobs)
      .set({
        jobStatus: terminalJobStatus,
        providerContentHash: result.providerObservedSha256,
        attemptCount,
        nextAttemptAt: null,
        completedAt: now,
        lastErrorCode: result.failureCode ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailLargeAttachmentScanJobs.id, context.job.id),
          eq(schema.mailLargeAttachmentScanJobs.jobStatus, "polling"),
        ),
      ),
    db
      .update(schema.mailLargeAttachmentLifecycle)
      .set({ updatedAt: now })
      .where(
        and(
          eq(schema.mailLargeAttachmentLifecycle.id, context.job.lifecycleId),
          notInArray(
            schema.mailLargeAttachmentLifecycle.status,
            [...TERMINAL_LARGE_ATTACHMENT_LIFECYCLE_STATUSES],
          ),
        ),
      ),
    db
      .update(schema.mailStoredFiles)
      .set({
        securityScanStatus: applied.status,
        securityScannedAt: now,
      })
      .where(
        and(
          eq(schema.mailStoredFiles.id, context.job.storedFileId),
          ne(schema.mailStoredFiles.securityScanStatus, "blocked"),
        ),
      ),
  ];
  const results = await runMailBatch(db, statements);
  assertBatchUpdateChanged(results, 0, "Scan completion CAS failed");
  assertBatchUpdateChanged(results, 1, "Scan lifecycle eligibility changed");
  assertBatchUpdateChanged(results, 2, "Scan file status CAS failed");
}

export function completeLargeAttachmentScanClean(
  db: Database,
  context: LoadedLargeAttachmentScanContext,
  result: LargeAttachmentMalwareScanResult,
  now: string,
): Promise<void> {
  return completeLargeAttachmentScanWithStatus(
    db,
    context,
    "clean",
    result,
    now,
  );
}

export function completeLargeAttachmentScanBlocked(
  db: Database,
  context: LoadedLargeAttachmentScanContext,
  result: LargeAttachmentMalwareScanResult,
  now: string,
): Promise<void> {
  return completeLargeAttachmentScanWithStatus(
    db,
    context,
    "blocked",
    result,
    now,
  );
}

export function failLargeAttachmentScan(
  db: Database,
  context: LoadedLargeAttachmentScanContext,
  result: LargeAttachmentMalwareScanResult,
  now: string,
): Promise<void> {
  return completeLargeAttachmentScanWithStatus(
    db,
    context,
    "scan_failed",
    result,
    now,
  );
}

export async function processClaimedLargeAttachmentScanJob(
  db: Database,
  input: {
    jobId: string;
    bucket: R2ScanBucket;
    scanner: LargeAttachmentMalwareScanner;
    now?: string;
  },
): Promise<LargeAttachmentMalwareScanProcessResult | { outcome: "skipped" }> {
  const now = input.now ?? new Date().toISOString();
  const context = await loadScanContext(db, input.jobId);
  if (!context || context.job.jobStatus !== "polling") {
    return { outcome: "skipped" };
  }
  if (
    TERMINAL_LARGE_ATTACHMENT_LIFECYCLE_STATUSES.includes(
      context.lifecycle.status as (typeof TERMINAL_LARGE_ATTACHMENT_LIFECYCLE_STATUSES)[number],
    )
  ) {
    await cancelTerminalScanJob(db, context.job, now);
    return { outcome: "skipped" };
  }
  if (context.job.provider !== input.scanner.provider) {
    await scheduleLargeAttachmentScanRetryOrFail(
      db,
      context,
      {
        status: "scan_failed",
        providerObservedSha256: null,
        failureCode: "CONFIGURATION",
        retryable: false,
      },
      now,
    );
    return { outcome: "skipped" };
  }
  if (
    context.storedFile.storageKey !== context.job.storageKey ||
    context.lifecycle.storageEtag !== context.job.storageEtag ||
    context.lifecycle.storageVersion !== context.job.storageVersion
  ) {
    await scheduleLargeAttachmentScanRetryOrFail(
      db,
      context,
      {
        status: "scan_failed",
        providerObservedSha256: null,
        failureCode: "STORAGE_IDENTITY_MISMATCH",
        retryable: false,
      },
      now,
    );
    return { outcome: "skipped" };
  }

  const result = await processLargeAttachmentMalwareScanJob({
    bucket: input.bucket,
    scanner: input.scanner,
    job: {
      lifecycleId: context.job.lifecycleId,
      storedFileId: context.job.storedFileId,
      declaredContentHash: context.job.declaredContentHash,
      storage: {
        storageKey: context.job.storageKey,
        sizeBytes: context.storedFile.sizeBytes,
        storageEtag: context.job.storageEtag,
        storageVersion: context.job.storageVersion,
      },
      filename: context.storedFile.originalFilename,
      mimeType: context.storedFile.mimeType,
      provider: context.job.provider,
      providerJobId: context.job.providerJobId ?? undefined,
    },
  });

  if (result.outcome === "submitted") {
    await recordLargeAttachmentScanProviderSubmission(
      db,
      context.job,
      result.result,
      now,
    );
    return result;
  }
  if (result.outcome === "failed") {
    await scheduleLargeAttachmentScanRetryOrFail(
      db,
      context,
      result.result,
      now,
    );
    return result;
  }

  if (result.result.status === "pending") {
    await recordLargeAttachmentScanProviderSubmission(
      db,
      context.job,
      {
        providerJobId: result.providerJobId,
        providerObservedSha256: result.result.providerObservedSha256,
      },
      now,
    );
    return result;
  }

  await completeLargeAttachmentScanWithStatus(
    db,
    context,
    statusForCompletedResult(result.result),
    result.result,
    now,
  );
  return result;
}

export async function processDueLargeAttachmentScanJobs(
  db: Database,
  input: {
    trustNow: string;
    limit: number;
    bucket: R2ScanBucket;
    scanner: LargeAttachmentMalwareScanner;
  },
): Promise<{
  selected: number;
  claimed: number;
  completed: number;
  retryScheduled: number;
  failed: number;
  skipped: number;
}> {
  const due = await listDueLargeAttachmentScanJobs(db, {
    trustNow: input.trustNow,
    limit: input.limit,
  });
  const summary = {
    selected: due.length,
    claimed: 0,
    completed: 0,
    retryScheduled: 0,
    failed: 0,
    skipped: 0,
  };
  for (const job of due) {
    const claimed = await claimLargeAttachmentScanJob(db, {
      jobId: job.id,
      trustNow: input.trustNow,
    });
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }
    summary.claimed += 1;
    const result = await processClaimedLargeAttachmentScanJob(db, {
      jobId: claimed.id,
      bucket: input.bucket,
      scanner: input.scanner,
      now: input.trustNow,
    });
    if (result.outcome === "skipped") {
      summary.skipped += 1;
    } else {
      const latest = await findLargeAttachmentScanJobById(db, claimed.id);
      if (latest?.jobStatus === "completed") {
        summary.completed += 1;
      } else if (latest?.jobStatus === "failed") {
        summary.failed += 1;
      } else if (latest?.jobStatus === "retry_wait") {
        summary.retryScheduled += 1;
      } else {
        summary.skipped += 1;
      }
    }
  }
  return summary;
}
