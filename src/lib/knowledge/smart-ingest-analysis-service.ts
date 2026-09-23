import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  canManageKnowledgeSource,
  requireKnowledgeIngestRole,
  type KnowledgeSourceMeta,
} from "@/lib/knowledge/source-service";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import {
  KNOWLEDGE_SOURCE_ANALYSIS_SCHEMA_VERSION,
  KNOWLEDGE_SOURCE_ANALYSIS_SEGMENTATION_MODE,
  type KnowledgeSourceAnalysisRunStatus,
} from "../../../drizzle/schema/knowledge-source-analysis-runs";
import type { KnowledgeSourceSegmentStatus } from "../../../drizzle/schema/knowledge-source-segments";
import {
  materializeDeterministicSegments,
  segmentKnowledgePasteTextDeterministic,
} from "@/lib/knowledge/smart-ingest-deterministic-segmentation";
import { buildKnowledgeAuditInsert, writeKnowledgeAudit } from "@/lib/knowledge/audit";

function analysisError(code: string, message: string, status = 400): KnowledgeServiceError {
  return new KnowledgeServiceError(code, message, status);
}

export type KnowledgeSourceAnalysisRunDetail = {
  id: string;
  sourceId: string;
  status: KnowledgeSourceAnalysisRunStatus;
  schemaVersion: string;
  segmentationMode: string;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  segments: KnowledgeSourceSegmentDetail[];
};

export type KnowledgeSourceSegmentDetail = {
  id: string;
  segmentIndex: number;
  titleHint: string;
  evidenceText: string;
  evidenceStart: number;
  evidenceEnd: number;
  status: KnowledgeSourceSegmentStatus;
  createdAt: string;
};

async function getSourceForAnalysis(
  context: KnowledgeSessionContext,
  sourceId: string,
  db: Database,
) {
  requireKnowledgeIngestRole(context);
  const source = (
    await db
      .select()
      .from(schema.knowledgeSources)
      .where(eq(schema.knowledgeSources.id, sourceId))
      .limit(1)
  )[0];
  if (!source) {
    throw analysisError(KNOWLEDGE_ERROR_CODES.SOURCE_NOT_FOUND, "来源不存在", 404);
  }
  if (!canManageKnowledgeSource(context, source)) {
    throw analysisError(KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED, "来源访问被拒绝", 403);
  }
  if (source.archivedAt) {
    throw analysisError(KNOWLEDGE_ERROR_CODES.SOURCE_ARCHIVED, "来源已归档", 409);
  }
  return source;
}

function assertPasteSourceForSmartIngest(
  source: typeof schema.knowledgeSources.$inferSelect,
): string {
  if (source.sourceType !== "paste") {
    throw analysisError(
      KNOWLEDGE_ERROR_CODES.ANALYSIS_UNSUPPORTED_SOURCE_TYPE,
      "智能分析目前仅支持贴上文字来源",
      400,
    );
  }
  const rawText = source.rawText?.trim() ?? "";
  if (!rawText) {
    throw analysisError(
      KNOWLEDGE_ERROR_CODES.ANALYSIS_EMPTY_SOURCE,
      "来源没有可分析的文字内容",
      400,
    );
  }
  return source.rawText!;
}

async function findActiveAnalysisRun(sourceId: string, db: Database) {
  return (
    await db
      .select()
      .from(schema.knowledgeSourceAnalysisRuns)
      .where(
        and(
          eq(schema.knowledgeSourceAnalysisRuns.sourceId, sourceId),
          inArray(schema.knowledgeSourceAnalysisRuns.status, ["pending", "processing"]),
        ),
      )
      .limit(1)
  )[0] ?? null;
}

async function supersedeSegmentsForReanalysis(sourceId: string, db: Database) {
  await db
    .update(schema.knowledgeSourceSegments)
    .set({ status: "superseded" })
    .where(
      and(
        eq(schema.knowledgeSourceSegments.sourceId, sourceId),
        inArray(schema.knowledgeSourceSegments.status, [
          "proposed",
          "confirmed",
          "rejected",
        ]),
      ),
    );
}

export async function startKnowledgeSourceAnalysis(
  context: KnowledgeSessionContext,
  sourceId: string,
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
): Promise<{ runId: string; status: "pending" }> {
  const source = await getSourceForAnalysis(context, sourceId, db);
  assertPasteSourceForSmartIngest(source);

  const active = await findActiveAnalysisRun(sourceId, db);
  if (active) {
    throw analysisError(
      KNOWLEDGE_ERROR_CODES.ANALYSIS_ALREADY_RUNNING,
      "此来源已有进行中的分析",
      409,
    );
  }

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();

  await supersedeSegmentsForReanalysis(sourceId, db);

  await db.batch([
    db.insert(schema.knowledgeSourceAnalysisRuns).values({
      id: runId,
      sourceId,
      requestedByUserId: context.user.id,
      status: "pending",
      schemaVersion: KNOWLEDGE_SOURCE_ANALYSIS_SCHEMA_VERSION,
      segmentationMode: KNOWLEDGE_SOURCE_ANALYSIS_SEGMENTATION_MODE,
      failureCode: null,
      failureMessage: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    }),
    db
      .update(schema.knowledgeSources)
      .set({ analysisStatus: "pending", updatedAt: now })
      .where(eq(schema.knowledgeSources.id, sourceId)),
    buildKnowledgeAuditInsert(db, {
      userId: context.user.id,
      action: "knowledge_source_analysis_started",
      entityType: "knowledge_source_analysis_run",
      entityId: runId,
      ...meta,
      metadata: { sourceId, status: "pending" },
    }),
  ]);

  return { runId, status: "pending" };
}

export async function processKnowledgeSourceAnalysisRun(
  runId: string,
  db: Database = getDb(),
): Promise<void> {
  const run = (
    await db
      .select()
      .from(schema.knowledgeSourceAnalysisRuns)
      .where(eq(schema.knowledgeSourceAnalysisRuns.id, runId))
      .limit(1)
  )[0];
  if (!run || run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    return;
  }

  const source = (
    await db
      .select()
      .from(schema.knowledgeSources)
      .where(eq(schema.knowledgeSources.id, run.sourceId))
      .limit(1)
  )[0];
  if (!source) {
    return;
  }

  const startedAt = new Date().toISOString();
  await db.batch([
    db
      .update(schema.knowledgeSourceAnalysisRuns)
      .set({ status: "processing", startedAt })
      .where(eq(schema.knowledgeSourceAnalysisRuns.id, runId)),
    db
      .update(schema.knowledgeSources)
      .set({ analysisStatus: "processing", updatedAt: startedAt })
      .where(eq(schema.knowledgeSources.id, run.sourceId)),
  ]);

  try {
    const rawText = assertPasteSourceForSmartIngest(source);
    const drafts = segmentKnowledgePasteTextDeterministic(rawText);
    if (drafts.length === 0) {
      throw analysisError(
        KNOWLEDGE_ERROR_CODES.ANALYSIS_EMPTY_SOURCE,
        "来源没有可分析的文字内容",
      );
    }
    const segments = materializeDeterministicSegments(rawText, drafts);
    for (const segment of segments) {
      const slice = rawText.slice(segment.evidenceStart, segment.evidenceEnd);
      if (slice !== segment.evidenceText) {
        throw analysisError(
          KNOWLEDGE_ERROR_CODES.ANALYSIS_SEGMENTATION_FAILED,
          "分段结果无法对应原文",
        );
      }
    }

    const completedAt = new Date().toISOString();
    const segmentRows = segments.map((segment) => ({
      id: crypto.randomUUID(),
      sourceId: run.sourceId,
      analysisRunId: runId,
      segmentIndex: segment.segmentIndex,
      titleHint: segment.titleHint,
      evidenceText: segment.evidenceText,
      evidenceStart: segment.evidenceStart,
      evidenceEnd: segment.evidenceEnd,
      status: "proposed" as const,
      createdAt: completedAt,
    }));

    for (const row of segmentRows) {
      await db.insert(schema.knowledgeSourceSegments).values(row);
    }
    await db.batch([
      db
        .update(schema.knowledgeSourceAnalysisRuns)
        .set({ status: "completed", completedAt, failureCode: null, failureMessage: null })
        .where(eq(schema.knowledgeSourceAnalysisRuns.id, runId)),
      db
        .update(schema.knowledgeSources)
        .set({ analysisStatus: "ready_for_review", updatedAt: completedAt })
        .where(eq(schema.knowledgeSources.id, run.sourceId)),
    ]);
  } catch (error) {
    const completedAt = new Date().toISOString();
    const failureCode =
      error instanceof KnowledgeServiceError
        ? error.errorCode
        : KNOWLEDGE_ERROR_CODES.ANALYSIS_SEGMENTATION_FAILED;
    const failureMessage =
      error instanceof KnowledgeServiceError ? error.message : "内容分段失败";
    await db.batch([
      db
        .update(schema.knowledgeSourceAnalysisRuns)
        .set({
          status: "failed",
          completedAt,
          failureCode,
          failureMessage,
        })
        .where(eq(schema.knowledgeSourceAnalysisRuns.id, runId)),
      db
        .update(schema.knowledgeSources)
        .set({ analysisStatus: "failed", updatedAt: completedAt })
        .where(eq(schema.knowledgeSources.id, run.sourceId)),
    ]);
  }
}

async function mapSegmentsForRun(
  runId: string,
  db: Database,
): Promise<KnowledgeSourceSegmentDetail[]> {
  const rows = await db
    .select()
    .from(schema.knowledgeSourceSegments)
    .where(eq(schema.knowledgeSourceSegments.analysisRunId, runId))
    .orderBy(schema.knowledgeSourceSegments.segmentIndex);
  return rows.map((row) => ({
    id: row.id,
    segmentIndex: row.segmentIndex,
    titleHint: row.titleHint,
    evidenceText: row.evidenceText,
    evidenceStart: row.evidenceStart,
    evidenceEnd: row.evidenceEnd,
    status: row.status,
    createdAt: row.createdAt,
  }));
}

export async function getKnowledgeSourceAnalysisRun(
  context: KnowledgeSessionContext,
  sourceId: string,
  runId: string,
  db: Database = getDb(),
): Promise<KnowledgeSourceAnalysisRunDetail> {
  await getSourceForAnalysis(context, sourceId, db);
  const run = (
    await db
      .select()
      .from(schema.knowledgeSourceAnalysisRuns)
      .where(
        and(
          eq(schema.knowledgeSourceAnalysisRuns.id, runId),
          eq(schema.knowledgeSourceAnalysisRuns.sourceId, sourceId),
        ),
      )
      .limit(1)
  )[0];
  if (!run) {
    throw analysisError(KNOWLEDGE_ERROR_CODES.ANALYSIS_RUN_NOT_FOUND, "分析记录不存在", 404);
  }
  return {
    id: run.id,
    sourceId: run.sourceId,
    status: run.status,
    schemaVersion: run.schemaVersion,
    segmentationMode: run.segmentationMode,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    segments: run.status === "completed" ? await mapSegmentsForRun(runId, db) : [],
  };
}

export async function getLatestKnowledgeSourceAnalysisRun(
  context: KnowledgeSessionContext,
  sourceId: string,
  db: Database = getDb(),
): Promise<KnowledgeSourceAnalysisRunDetail | null> {
  await getSourceForAnalysis(context, sourceId, db);
  const run = (
    await db
      .select()
      .from(schema.knowledgeSourceAnalysisRuns)
      .where(eq(schema.knowledgeSourceAnalysisRuns.sourceId, sourceId))
      .orderBy(desc(schema.knowledgeSourceAnalysisRuns.createdAt))
      .limit(1)
  )[0];
  if (!run) return null;
  return getKnowledgeSourceAnalysisRun(context, sourceId, run.id, db);
}

export async function updateKnowledgeSourceSegmentStatus(
  context: KnowledgeSessionContext,
  sourceId: string,
  segmentId: string,
  status: "proposed" | "confirmed" | "rejected",
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
): Promise<KnowledgeSourceSegmentDetail> {
  const source = await getSourceForAnalysis(context, sourceId, db);
  const segment = (
    await db
      .select()
      .from(schema.knowledgeSourceSegments)
      .where(
        and(
          eq(schema.knowledgeSourceSegments.id, segmentId),
          eq(schema.knowledgeSourceSegments.sourceId, sourceId),
        ),
      )
      .limit(1)
  )[0];
  if (!segment) {
    throw analysisError(KNOWLEDGE_ERROR_CODES.ANALYSIS_SEGMENT_NOT_FOUND, "分段不存在", 404);
  }
  if (segment.status === "superseded") {
    throw analysisError(KNOWLEDGE_ERROR_CODES.ANALYSIS_SEGMENT_NOT_FOUND, "分段已失效", 409);
  }
  const now = new Date().toISOString();
  await db.batch([
    db
      .update(schema.knowledgeSourceSegments)
      .set({ status })
      .where(eq(schema.knowledgeSourceSegments.id, segmentId)),
    db
      .update(schema.knowledgeSources)
      .set({ updatedAt: now })
      .where(eq(schema.knowledgeSources.id, source.id)),
    buildKnowledgeAuditInsert(db, {
      userId: context.user.id,
      action: "knowledge_source_segment_reviewed",
      entityType: "knowledge_source_segment",
      entityId: segmentId,
      ...meta,
      metadata: { sourceId, status },
    }),
  ]);
  const updated = (
    await db
      .select()
      .from(schema.knowledgeSourceSegments)
      .where(eq(schema.knowledgeSourceSegments.id, segmentId))
      .limit(1)
  )[0]!;
  return {
    id: updated.id,
    segmentIndex: updated.segmentIndex,
    titleHint: updated.titleHint,
    evidenceText: updated.evidenceText,
    evidenceStart: updated.evidenceStart,
    evidenceEnd: updated.evidenceEnd,
    status: updated.status,
    createdAt: updated.createdAt,
  };
}

export function scheduleKnowledgeSourceAnalysisProcessing(runId: string): void {
  void processKnowledgeSourceAnalysisRun(runId).catch(() => {
    // failure persisted in processKnowledgeSourceAnalysisRun
  });
}
