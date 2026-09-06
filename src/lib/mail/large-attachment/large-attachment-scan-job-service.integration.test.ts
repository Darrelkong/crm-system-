import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import {
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";
import { buildLargeAttachmentScanJobInsert } from "./large-attachment-scan-job-service";
import {
  claimLargeAttachmentScanJob,
  processDueLargeAttachmentScanJobs,
} from "./large-attachment-scan-job-service";
import type { R2ScanBucket } from "./large-attachment-malware-scan-service";
import type { LargeAttachmentMalwareScanner } from "./large-attachment-malware-scanner";

const NOW = "2026-09-06T12:00:00.000Z";
const POLL_NOW = "2026-09-06T12:00:06.000Z";
const STORED_FILE_ID = "scan-job-integration-file";
const LIFECYCLE_ID = "scan-job-integration-lifecycle";
const JOB_ID = "scan-job-integration-job";
const CONTENT_HASH = "c".repeat(64);
const STORAGE_KEY = "mail/large-attachments/scan-job-integration";
const STORAGE_ETAG = "scan-job-etag";
const STORAGE_VERSION = "scan-job-version";
const SIZE_BYTES = 32 * 1024 * 1024;

type LocalR2Bucket = R2ScanBucket & {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
};

describe("durable large attachment scan jobs", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let r2Bucket: LocalR2Bucket;
  let r2Dispose: (() => Promise<void>) | undefined;
  let consumedBytes = 0;
  let activeEtag = STORAGE_ETAG;
  let activeVersion: string | null = STORAGE_VERSION;

  before(async () => {
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;
    const r2Proxy = await getPlatformProxy<{
      LARGE_ATTACHMENTS: LocalR2Bucket;
    }>({
      configPath: "wrangler.mail-jobs-cron.local.jsonc",
    });
    r2Bucket = r2Proxy.env.LARGE_ATTACHMENTS;
    r2Dispose = r2Proxy.dispose;
    await db.delete(schema.mailLargeAttachmentScanJobs);
    await db
      .delete(schema.mailLargeAttachmentLifecycle)
      .where(eq(schema.mailLargeAttachmentLifecycle.id, LIFECYCLE_ID));
    await db
      .delete(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID));

    await db.insert(schema.mailStoredFiles).values({
      id: STORED_FILE_ID,
      contentHash: CONTENT_HASH,
      originalFilename: "synthetic-32MiB.bin",
      mimeType: "application/octet-stream",
      sizeBytes: SIZE_BYTES,
      storageProvider: "r2",
      storageBucket: "crm-mail-large-attachments",
      storageKey: STORAGE_KEY,
      createdByUserId: null,
      securityScanStatus: "unscanned",
      securityScannedAt: null,
      createdAt: NOW,
    });
    await db.insert(schema.mailLargeAttachmentLifecycle).values({
      id: LIFECYCLE_ID,
      storedFileId: STORED_FILE_ID,
      status: "temporary",
      uploadedAt: NOW,
      temporaryExpiresAt: "2026-09-07T12:00:00.000Z",
      approvalHoldStartedAt: null,
      approvalAbsoluteExpiresAt: null,
      sentAt: null,
      recipientExpiresAt: null,
      deletedAt: null,
      deleteReason: null,
      downloadTokenHash: null,
      downloadCount: 0,
      lastDownloadedAt: null,
      declaredContentHash: CONTENT_HASH,
      storageVersion: STORAGE_VERSION,
      storageEtag: STORAGE_ETAG,
      finalizedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(schema.mailLargeAttachmentScanJobs).values(
      buildLargeAttachmentScanJobInsert({
        id: JOB_ID,
        lifecycleId: LIFECYCLE_ID,
        storedFileId: STORED_FILE_ID,
        provider: "test-provider",
        storageKey: STORAGE_KEY,
        storageEtag: STORAGE_ETAG,
        storageVersion: STORAGE_VERSION,
        declaredContentHash: CONTENT_HASH,
        now: NOW,
      }),
    );
  });

  after(async () => {
    await db.delete(schema.mailLargeAttachmentScanJobs);
    await db
      .delete(schema.mailLargeAttachmentLifecycle)
      .where(eq(schema.mailLargeAttachmentLifecycle.id, LIFECYCLE_ID));
    await db
      .delete(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID));
    await teardownMailReadApiDb(db, dispose);
    await r2Bucket.delete(STORAGE_KEY);
    await r2Dispose?.();
  });

  it("processes a durable 32 MiB finalize-created job asynchronously", async () => {
    const scanner: LargeAttachmentMalwareScanner = {
      provider: "test-provider",
      async submit(input) {
        assert.ok(input.body instanceof ReadableStream);
        const reader = input.body.getReader();
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          consumedBytes += next.value.byteLength;
        }
        return {
          providerJobId: "provider-scan-job-1",
          status: "pending",
          providerObservedSha256: CONTENT_HASH,
        };
      },
      async poll(input) {
        assert.equal(input.providerJobId, "provider-scan-job-1");
        return {
          providerJobId: input.providerJobId,
          status: "clean",
          providerObservedSha256: CONTENT_HASH,
        };
      },
    };
    await r2Bucket.put(STORAGE_KEY, new Uint8Array(SIZE_BYTES), {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    const actualObject = await r2Bucket.head(STORAGE_KEY);
    assert.ok(actualObject);
    activeEtag = actualObject.etag;
    activeVersion = actualObject.version ?? null;
    await db
      .update(schema.mailLargeAttachmentLifecycle)
      .set({
        storageEtag: activeEtag,
        storageVersion: activeVersion,
      })
      .where(eq(schema.mailLargeAttachmentLifecycle.id, LIFECYCLE_ID));
    await db
      .update(schema.mailLargeAttachmentScanJobs)
      .set({
        storageEtag: activeEtag,
        storageVersion: activeVersion,
      })
      .where(eq(schema.mailLargeAttachmentScanJobs.id, JOB_ID));

    const submitted = await processDueLargeAttachmentScanJobs(db, {
      trustNow: NOW,
      limit: 10,
      bucket: r2Bucket,
      scanner,
    });
    assert.equal(submitted.selected, 1);
    assert.equal(submitted.claimed, 1);
    assert.equal(submitted.completed, 0);
    assert.equal(consumedBytes, SIZE_BYTES);

    const [submittedJob] = await db
      .select()
      .from(schema.mailLargeAttachmentScanJobs)
      .where(eq(schema.mailLargeAttachmentScanJobs.id, JOB_ID))
      .limit(1);
    assert.equal(submittedJob?.jobStatus, "submitted");
    assert.equal(submittedJob?.providerJobId, "provider-scan-job-1");
    assert.equal(submittedJob?.providerContentHash, CONTENT_HASH);

    const completed = await processDueLargeAttachmentScanJobs(db, {
      trustNow: POLL_NOW,
      limit: 10,
      bucket: r2Bucket,
      scanner,
    });
    assert.equal(completed.completed, 1);

    const [storedFile] = await db
      .select()
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID))
      .limit(1);
    assert.equal(storedFile?.securityScanStatus, "clean");
    const [job] = await db
      .select()
      .from(schema.mailLargeAttachmentScanJobs)
      .where(eq(schema.mailLargeAttachmentScanJobs.id, JOB_ID))
      .limit(1);
    assert.equal(job?.jobStatus, "completed");
    assert.equal(job?.completedAt, POLL_NOW);
  });

  it("claims a due job once under duplicate delivery", async () => {
    await db
      .update(schema.mailLargeAttachmentScanJobs)
      .set({
        jobStatus: "queued",
        providerJobId: null,
        providerContentHash: null,
        attemptCount: 0,
        nextAttemptAt: NOW,
        submittedAt: null,
        completedAt: null,
        lastErrorCode: null,
        updatedAt: NOW,
      })
      .where(eq(schema.mailLargeAttachmentScanJobs.id, JOB_ID));
    await db
      .update(schema.mailStoredFiles)
      .set({
        securityScanStatus: "unscanned",
        securityScannedAt: null,
      })
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID));
    const [first, second] = await Promise.all([
      claimLargeAttachmentScanJob(db, {
        jobId: JOB_ID,
        trustNow: "2026-09-06T12:00:07.000Z",
      }),
      claimLargeAttachmentScanJob(db, {
        jobId: JOB_ID,
        trustNow: "2026-09-06T12:00:07.000Z",
      }),
    ]);
    assert.equal(
      [first, second].filter((claim) => claim !== null).length,
      1,
    );
  });

  it("preserves blocked and terminal lifecycle safety", async () => {
    await db
      .update(schema.mailLargeAttachmentScanJobs)
      .set({
        jobStatus: "queued",
        providerJobId: null,
        providerContentHash: null,
        attemptCount: 0,
        nextAttemptAt: NOW,
        submittedAt: null,
        completedAt: null,
        lastErrorCode: null,
        updatedAt: NOW,
      })
      .where(eq(schema.mailLargeAttachmentScanJobs.id, JOB_ID));
    await db
      .update(schema.mailStoredFiles)
      .set({ securityScanStatus: "unscanned", securityScannedAt: null })
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID));

    const blockedScanner: LargeAttachmentMalwareScanner = {
      provider: "test-provider",
      async submit() {
        return {
          providerJobId: "provider-blocked",
          status: "pending",
          providerObservedSha256: CONTENT_HASH,
        };
      },
      async poll(input) {
        return {
          providerJobId: input.providerJobId,
          status: "blocked",
          providerObservedSha256: CONTENT_HASH,
        };
      },
    };
    const bucket = {
      async head() {
        return {
          etag: activeEtag,
          size: SIZE_BYTES,
          version: activeVersion ?? undefined,
        };
      },
      async get() {
        return {
          etag: activeEtag,
          size: SIZE_BYTES,
          version: activeVersion ?? undefined,
          body: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        };
      },
    };

    await processDueLargeAttachmentScanJobs(db, {
      trustNow: NOW,
      limit: 10,
      bucket,
      scanner: blockedScanner,
    });
    await processDueLargeAttachmentScanJobs(db, {
      trustNow: POLL_NOW,
      limit: 10,
      bucket,
      scanner: blockedScanner,
    });
    const [blockedFile] = await db
      .select()
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID))
      .limit(1);
    assert.equal(blockedFile?.securityScanStatus, "blocked");

    await db
      .update(schema.mailLargeAttachmentScanJobs)
      .set({
        jobStatus: "submitted",
        providerJobId: "provider-stale-clean",
        nextAttemptAt: NOW,
        updatedAt: NOW,
      })
      .where(eq(schema.mailLargeAttachmentScanJobs.id, JOB_ID));
    const staleCleanScanner: LargeAttachmentMalwareScanner = {
      provider: "test-provider",
      async submit() {
        throw new Error("stale clean must poll only");
      },
      async poll(input) {
        return {
          providerJobId: input.providerJobId,
          status: "clean",
          providerObservedSha256: CONTENT_HASH,
        };
      },
    };
    await processDueLargeAttachmentScanJobs(db, {
      trustNow: "2026-09-06T12:01:00.000Z",
      limit: 10,
      bucket,
      scanner: staleCleanScanner,
    });
    const [stillBlocked] = await db
      .select()
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID))
      .limit(1);
    assert.equal(stillBlocked?.securityScanStatus, "blocked");

    await db
      .update(schema.mailLargeAttachmentScanJobs)
      .set({
        jobStatus: "queued",
        providerJobId: null,
        nextAttemptAt: NOW,
        completedAt: null,
        updatedAt: NOW,
      })
      .where(eq(schema.mailLargeAttachmentScanJobs.id, JOB_ID));
    await db
      .update(schema.mailStoredFiles)
      .set({ securityScanStatus: "unscanned", securityScannedAt: null })
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID));
    await db
      .update(schema.mailLargeAttachmentLifecycle)
      .set({ status: "deleted", deletedAt: NOW, updatedAt: NOW })
      .where(eq(schema.mailLargeAttachmentLifecycle.id, LIFECYCLE_ID));

    await processDueLargeAttachmentScanJobs(db, {
      trustNow: "2026-09-06T12:02:00.000Z",
      limit: 10,
      bucket,
      scanner: staleCleanScanner,
    });
    const [cancelledJob] = await db
      .select()
      .from(schema.mailLargeAttachmentScanJobs)
      .where(eq(schema.mailLargeAttachmentScanJobs.id, JOB_ID))
      .limit(1);
    assert.equal(cancelledJob?.jobStatus, "cancelled");
    const [terminalFile] = await db
      .select()
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID))
      .limit(1);
    assert.equal(terminalFile?.securityScanStatus, "unscanned");
  });

  it("exhausts bounded provider retries into scan_failed", async () => {
    await db
      .update(schema.mailLargeAttachmentLifecycle)
      .set({
        status: "temporary",
        deletedAt: null,
        updatedAt: NOW,
      })
      .where(eq(schema.mailLargeAttachmentLifecycle.id, LIFECYCLE_ID));
    await db
      .update(schema.mailLargeAttachmentScanJobs)
      .set({
        jobStatus: "queued",
        providerJobId: null,
        providerContentHash: null,
        attemptCount: 0,
        nextAttemptAt: NOW,
        submittedAt: null,
        completedAt: null,
        lastErrorCode: null,
        updatedAt: NOW,
      })
      .where(eq(schema.mailLargeAttachmentScanJobs.id, JOB_ID));
    await db
      .update(schema.mailStoredFiles)
      .set({ securityScanStatus: "unscanned", securityScannedAt: null })
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID));

    const failingScanner: LargeAttachmentMalwareScanner = {
      provider: "test-provider",
      async submit() {
        throw new Error("temporary provider failure");
      },
      async poll() {
        throw new Error("poll should not run");
      },
    };
    const bucket = {
      async head() {
        return {
          etag: activeEtag,
          size: SIZE_BYTES,
          version: activeVersion ?? undefined,
        };
      },
      async get() {
        return {
          etag: activeEtag,
          size: SIZE_BYTES,
          version: activeVersion ?? undefined,
          body: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        };
      },
    };

    await processDueLargeAttachmentScanJobs(db, {
      trustNow: "2026-09-06T12:03:00.000Z",
      limit: 10,
      bucket,
      scanner: failingScanner,
    });
    await processDueLargeAttachmentScanJobs(db, {
      trustNow: "2026-09-06T12:03:06.000Z",
      limit: 10,
      bucket,
      scanner: failingScanner,
    });
    const final = await processDueLargeAttachmentScanJobs(db, {
      trustNow: "2026-09-06T12:03:17.000Z",
      limit: 10,
      bucket,
      scanner: failingScanner,
    });
    assert.equal(final.failed, 1);
    const [failedFile] = await db
      .select()
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, STORED_FILE_ID))
      .limit(1);
    assert.equal(failedFile?.securityScanStatus, "scan_failed");
    const [failedJob] = await db
      .select()
      .from(schema.mailLargeAttachmentScanJobs)
      .where(eq(schema.mailLargeAttachmentScanJobs.id, JOB_ID))
      .limit(1);
    assert.equal(failedJob?.jobStatus, "failed");
    assert.equal(failedJob?.attemptCount, 3);
  });
});
