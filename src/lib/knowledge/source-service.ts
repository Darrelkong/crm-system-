import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import {
  KNOWLEDGE_ERROR_CODES,
} from "@/lib/knowledge/constants";
import { buildKnowledgeAuditInsert, writeKnowledgeAudit } from "@/lib/knowledge/audit";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import {
  createKnowledgeArticle,
  parseArticleInput,
} from "@/lib/knowledge/core-service";
import {
  createKnowledgeSourceStorageKey,
  getKnowledgeSourceStorage,
  type KnowledgeSourceStorage,
} from "@/lib/knowledge/source-storage";
import type {
  KnowledgeSource,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from "../../../drizzle/schema/knowledge-sources";
import type { KnowledgeAiOrganizationRun } from "../../../drizzle/schema/knowledge-ai-organization-runs";

export const KNOWLEDGE_SOURCE_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const KNOWLEDGE_SOURCE_TEXT_MAX_CHARS = 100_000;
export const KNOWLEDGE_SOURCE_TITLE_MAX = 200;
export const KNOWLEDGE_SOURCE_FILENAME_MAX = 255;

const TEXT_MIME_TYPES = new Set(["text/plain", "application/octet-stream"]);
const MARKDOWN_MIME_TYPES = new Set([
  "text/markdown",
  "text/plain",
  "application/octet-stream",
]);
const PDF_MIME_TYPES = new Set(["application/pdf"]);
const DOCX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".com",
  ".scr",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".js",
  ".msi",
  ".app",
  ".dmg",
  ".pkg",
  ".apk",
  ".jar",
  ".sh",
  ".iso",
  ".img",
  ".rar",
  ".7z",
  ".zip",
]);

export type KnowledgeSourceListItem = {
  id: string;
  sourceType: KnowledgeSourceType;
  sourceTitle: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: KnowledgeSourceStatus;
  failureCode: string | null;
  linkedArticleId: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
};

export type KnowledgeSourceDetail = KnowledgeSourceListItem & {
  rawText: string | null;
  storageKey: string | null;
  contentHash: string;
  organization: {
    id: string;
    status: KnowledgeAiOrganizationRun["status"];
    provider: string | null;
    model: string | null;
    proposedTitle: string | null;
    proposedSummary: string | null;
    proposedBody: string | null;
    proposedCategory: string | null;
    warnings: string[];
    failureCode: string | null;
    createdAt: string;
    completedAt: string | null;
  } | null;
};

export type KnowledgeSourceMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

function sourceError(
  code: string,
  message: string,
  status = 400,
): KnowledgeServiceError {
  return new KnowledgeServiceError(code, message, status);
}

function requireContributor(context: KnowledgeSessionContext): void {
  if (
    context.role !== "contributor" &&
    context.role !== "knowledge_admin"
  ) {
    throw sourceError(KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED, "Knowledge 权限不足", 403);
  }
}

function canManageSource(
  context: KnowledgeSessionContext,
  source: Pick<KnowledgeSource, "createdByUserId">,
): boolean {
  return (
    context.role === "knowledge_admin" ||
    (context.role === "contributor" && source.createdByUserId === context.user.id)
  );
}

function canViewSource(
  context: KnowledgeSessionContext,
  source: Pick<KnowledgeSource, "createdByUserId">,
): boolean {
  return (
    context.role === "knowledge_admin" ||
    source.createdByUserId === context.user.id
  );
}

function normalizeTitle(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw sourceError(KNOWLEDGE_ERROR_CODES.SOURCE_INVALID, "来源标题格式无效");
  }
  const title = value.trim();
  if (title.length > KNOWLEDGE_SOURCE_TITLE_MAX) {
    throw sourceError(KNOWLEDGE_ERROR_CODES.SOURCE_INVALID, "来源标题过长");
  }
  return title || null;
}

export function normalizeKnowledgeFilename(value: unknown): string {
  if (typeof value !== "string") {
    throw sourceError(KNOWLEDGE_ERROR_CODES.UNSAFE_FILENAME, "文件名无效");
  }
  const normalized = value.normalize("NFKC");
  if (
    !normalized ||
    normalized.length > KNOWLEDGE_SOURCE_FILENAME_MAX ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw sourceError(KNOWLEDGE_ERROR_CODES.UNSAFE_FILENAME, "文件名不安全");
  }
  return normalized;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLocaleLowerCase() : "";
}

export function supportedKnowledgeExtensions(): string[] {
  return [".txt", ".md", ".pdf", ".docx"];
}

function assertFileType(filename: string, mimeType: string): string {
  const extension = extensionOf(filename);
  if (BLOCKED_EXTENSIONS.has(extension)) {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      "不支持此类高风险文件",
    );
  }
  const expected =
    extension === ".txt"
      ? TEXT_MIME_TYPES
      : extension === ".md"
        ? MARKDOWN_MIME_TYPES
        : extension === ".pdf"
          ? PDF_MIME_TYPES
          : extension === ".docx"
            ? DOCX_MIME_TYPES
            : null;
  if (!expected) {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      "仅支持 TXT、Markdown、PDF 或 DOCX 文件",
    );
  }
  if (mimeType && !expected.has(mimeType.toLocaleLowerCase())) {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.MIME_MISMATCH,
      "文件类型与扩展名不匹配",
    );
  }
  return extension;
}

export function validateKnowledgeFileMetadata(input: {
  filename: unknown;
  mimeType: unknown;
  sizeBytes: unknown;
}): { filename: string; mimeType: string; sizeBytes: number; extension: string } {
  const filename = normalizeKnowledgeFilename(input.filename);
  const mimeType =
    typeof input.mimeType === "string" ? input.mimeType.trim().toLocaleLowerCase() : "";
  const sizeBytes = Number(input.sizeBytes);
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > KNOWLEDGE_SOURCE_FILE_MAX_BYTES
  ) {
    throw sourceError(
      sizeBytes > KNOWLEDGE_SOURCE_FILE_MAX_BYTES
        ? KNOWLEDGE_ERROR_CODES.FILE_TOO_LARGE
        : KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "文件大小无效或超过 20 MiB 限制",
    );
  }
  const extension = assertFileType(filename, mimeType);
  return { filename, mimeType, sizeBytes, extension };
}

export function validateKnowledgePasteText(input: {
  sourceTitle?: unknown;
  rawText?: unknown;
}): { sourceTitle: string | null; rawText: string } {
  const rawText = input.rawText;
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw sourceError(KNOWLEDGE_ERROR_CODES.SOURCE_INVALID, "请输入有意义的来源文字");
  }
  if (rawText.length > KNOWLEDGE_SOURCE_TEXT_MAX_CHARS) {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "来源文字过长，请分成较小的资料来源",
    );
  }
  return { sourceTitle: normalizeTitle(input.sourceTitle), rawText: rawText.trim() };
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function textBytes(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

export function extractKnowledgeText(
  bytes: ArrayBuffer,
  extension: string,
): { text: string; status: "ready" } {
  if (extension !== ".txt" && extension !== ".md") {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_UNAVAILABLE,
      "此文件格式目前无法安全提取文字",
    );
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    if (!text || text.length > KNOWLEDGE_SOURCE_TEXT_MAX_CHARS) {
      throw sourceError(
        KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
        "无法从文件取得合适的文字内容",
      );
    }
    if (text.includes("\u0000")) {
      throw sourceError(
        KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
        "文件文字内容无效",
      );
    }
    return { text, status: "ready" };
  } catch (error) {
    if (error instanceof KnowledgeServiceError) throw error;
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
      "文件文字提取失败",
    );
  }
}

function toListItem(source: KnowledgeSource): KnowledgeSourceListItem {
  return {
    id: source.id,
    sourceType: source.sourceType,
    sourceTitle: source.sourceTitle,
    originalFilename: source.originalFilename,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    status: source.status,
    failureCode: source.failureCode,
    linkedArticleId: source.linkedArticleId,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    processedAt: source.processedAt,
  };
}

async function getSourceRow(
  context: KnowledgeSessionContext,
  sourceId: string,
  db: Database,
): Promise<KnowledgeSource> {
  const source = (
    await db
      .select()
      .from(schema.knowledgeSources)
      .where(eq(schema.knowledgeSources.id, sourceId))
      .limit(1)
  )[0];
  if (!source) {
    throw sourceError(KNOWLEDGE_ERROR_CODES.SOURCE_NOT_FOUND, "来源不存在", 404);
  }
  if (!canViewSource(context, source)) {
    throw sourceError(KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED, "来源访问被拒绝", 403);
  }
  return source;
}

async function latestOrganization(
  sourceId: string,
  db: Database,
): Promise<KnowledgeAiOrganizationRun | null> {
  return (
    await db
      .select()
      .from(schema.knowledgeAiOrganizationRuns)
      .where(eq(schema.knowledgeAiOrganizationRuns.sourceId, sourceId))
      .orderBy(desc(schema.knowledgeAiOrganizationRuns.createdAt))
      .limit(1)
  )[0] ?? null;
}

function mapOrganization(
  run: KnowledgeAiOrganizationRun | null,
): KnowledgeSourceDetail["organization"] {
  if (!run) return null;
  let warnings: string[] = [];
  if (run.warningsJson) {
    try {
      const parsed = JSON.parse(run.warningsJson) as unknown;
      if (Array.isArray(parsed)) {
        warnings = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      warnings = [];
    }
  }
  return {
    id: run.id,
    status: run.status,
    provider: run.provider,
    model: run.model,
    proposedTitle: run.proposedTitle,
    proposedSummary: run.proposedSummary,
    proposedBody: run.proposedBody,
    proposedCategory: run.proposedCategory,
    warnings,
    failureCode: run.failureCode,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}

export async function listKnowledgeSources(
  context: KnowledgeSessionContext,
  db: Database = getDb(),
): Promise<KnowledgeSourceListItem[]> {
  const rows = await db
    .select()
    .from(schema.knowledgeSources)
    .where(
      context.role === "knowledge_admin"
        ? undefined
        : eq(schema.knowledgeSources.createdByUserId, context.user.id),
    )
    .orderBy(desc(schema.knowledgeSources.updatedAt));
  return rows.map(toListItem);
}

export async function getKnowledgeSource(
  context: KnowledgeSessionContext,
  sourceId: string,
  db: Database = getDb(),
): Promise<KnowledgeSourceDetail> {
  const source = await getSourceRow(context, sourceId, db);
  return {
    ...toListItem(source),
    rawText: source.rawText,
    storageKey: source.storageKey,
    contentHash: source.contentHash,
    organization: mapOrganization(await latestOrganization(source.id, db)),
  };
}

export async function createKnowledgePasteSource(
  context: KnowledgeSessionContext,
  input: { sourceTitle?: unknown; rawText?: unknown },
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
): Promise<KnowledgeSourceDetail> {
  requireContributor(context);
  const values = validateKnowledgePasteText(input);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const contentHash = await sha256Hex(textBytes(values.rawText));
  await db.batch([
    db.insert(schema.knowledgeSources).values({
      id,
      sourceType: "paste",
      sourceTitle: values.sourceTitle,
      originalFilename: null,
      mimeType: "text/plain",
      sizeBytes: new TextEncoder().encode(values.rawText).byteLength,
      rawText: values.rawText,
      storageKey: null,
      contentHash,
      status: "ready",
      createdByUserId: context.user.id,
      createdAt: now,
      updatedAt: now,
      processedAt: now,
      failureCode: null,
      linkedArticleId: null,
    }),
    buildKnowledgeAuditInsert(db, {
      userId: context.user.id,
      action: "knowledge_source_created",
      entityType: "knowledge_source",
      entityId: id,
      ...meta,
      metadata: { sourceType: "paste", status: "ready" },
    }),
    buildKnowledgeAuditInsert(db, {
      userId: context.user.id,
      action: "knowledge_source_extracted",
      entityType: "knowledge_source",
      entityId: id,
      ...meta,
      metadata: { sourceType: "paste", status: "ready" },
    }),
  ]);
  return getKnowledgeSource(context, id, db);
}

export async function createKnowledgeFileSource(
  context: KnowledgeSessionContext,
  file: { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
  storage: KnowledgeSourceStorage = getKnowledgeSourceStorage(),
): Promise<KnowledgeSourceDetail> {
  requireContributor(context);
  const metadata = validateKnowledgeFileMetadata({
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== metadata.sizeBytes) {
    throw sourceError(KNOWLEDGE_ERROR_CODES.SOURCE_INVALID, "文件大小验证失败");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const storageKey = createKnowledgeSourceStorageKey();
  const contentHash = await sha256Hex(bytes);
  await db.insert(schema.knowledgeSources).values({
    id,
    sourceType: "file",
    sourceTitle: null,
    originalFilename: metadata.filename,
    mimeType: metadata.mimeType || null,
    sizeBytes: metadata.sizeBytes,
    rawText: null,
    storageKey,
    contentHash,
    status: "received",
    createdByUserId: context.user.id,
    createdAt: now,
    updatedAt: now,
    processedAt: null,
    failureCode: null,
    linkedArticleId: null,
  });
  await writeKnowledgeAudit(
    {
      userId: context.user.id,
      action: "knowledge_source_created",
      entityType: "knowledge_source",
      entityId: id,
      ...meta,
      metadata: { sourceType: "file", status: "received" },
    },
    db,
  );

  try {
    await storage.put(storageKey, bytes, {
      contentType: metadata.mimeType || "application/octet-stream",
      sourceId: id,
    });
  } catch {
    await db
      .update(schema.knowledgeSources)
      .set({
        status: "failed",
        failureCode: KNOWLEDGE_ERROR_CODES.STORAGE_UNAVAILABLE,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.knowledgeSources.id, id));
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.STORAGE_UNAVAILABLE,
      "来源文件暂时无法安全储存，请稍后再试",
      503,
    );
  }

  await writeKnowledgeAudit(
    {
      userId: context.user.id,
      action: "knowledge_source_uploaded",
      entityType: "knowledge_source",
      entityId: id,
      ...meta,
      metadata: { sourceType: "file", status: "received" },
    },
    db,
  );
  await db
    .update(schema.knowledgeSources)
    .set({ status: "extracting", updatedAt: new Date().toISOString() })
    .where(eq(schema.knowledgeSources.id, id));

  try {
    const extracted = extractKnowledgeText(bytes, metadata.extension);
    const processedAt = new Date().toISOString();
    await db
      .update(schema.knowledgeSources)
      .set({
        rawText: extracted.text,
        status: "ready",
        processedAt,
        updatedAt: processedAt,
        failureCode: null,
      })
      .where(eq(schema.knowledgeSources.id, id));
    await writeKnowledgeAudit(
      {
        userId: context.user.id,
        action: "knowledge_source_extracted",
        entityType: "knowledge_source",
        entityId: id,
        ...meta,
        metadata: { sourceType: "file", status: "ready" },
      },
      db,
    );
  } catch (error) {
    const failureCode =
      error instanceof KnowledgeServiceError
        ? error.errorCode
        : KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED;
    await db
      .update(schema.knowledgeSources)
      .set({
        status: "failed",
        failureCode,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.knowledgeSources.id, id));
    throw error instanceof KnowledgeServiceError
      ? error
      : sourceError(failureCode, "来源文字提取失败");
  }

  return getKnowledgeSource(context, id, db);
}

export async function markKnowledgeSourceOrganizing(
  context: KnowledgeSessionContext,
  sourceId: string,
  db: Database = getDb(),
): Promise<KnowledgeSource> {
  const source = await getSourceRow(context, sourceId, db);
  if (!canManageSource(context, source)) {
    throw sourceError(KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED, "来源整理权限不足", 403);
  }
  if (source.status !== "ready" && source.status !== "organized") {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "来源目前不能进行 AI 整理",
      409,
    );
  }
  const updatedAt = new Date().toISOString();
  await db
    .update(schema.knowledgeSources)
    .set({ status: "organizing", failureCode: null, updatedAt })
    .where(
      and(
        eq(schema.knowledgeSources.id, sourceId),
        eq(schema.knowledgeSources.status, source.status),
        isNull(schema.knowledgeSources.linkedArticleId),
      ),
    );
  const updated = (
    await db
      .select()
      .from(schema.knowledgeSources)
      .where(eq(schema.knowledgeSources.id, sourceId))
      .limit(1)
  )[0];
  if (!updated || updated.status !== "organizing") {
    throw sourceError(KNOWLEDGE_ERROR_CODES.AI_RUN_CONFLICT, "来源正在被其他整理操作使用", 409);
  }
  return updated;
}

export async function finishKnowledgeSourceOrganization(
  sourceId: string,
  status: "organized" | "failed",
  failureCode: string | null,
  db: Database = getDb(),
): Promise<void> {
  await db
    .update(schema.knowledgeSources)
    .set({
      status,
      failureCode,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.knowledgeSources.id, sourceId));
}

export async function markKnowledgeSourceConverted(
  context: KnowledgeSessionContext,
  sourceId: string,
  articleId: string,
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
): Promise<void> {
  const source = await getSourceRow(context, sourceId, db);
  if (!canManageSource(context, source)) {
    throw sourceError(KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED, "来源转换权限不足", 403);
  }
  if (source.linkedArticleId || source.status === "converted") {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.SOURCE_ALREADY_CONVERTED,
      "此来源已经转换为草稿",
      409,
    );
  }
  const result = await db
    .update(schema.knowledgeSources)
    .set({
      linkedArticleId: articleId,
      status: "converted",
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.knowledgeSources.id, sourceId),
        eq(schema.knowledgeSources.status, "organized"),
        isNull(schema.knowledgeSources.linkedArticleId),
      ),
    );
  if (result.meta.changes !== 1) {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.SOURCE_ALREADY_CONVERTED,
      "此来源已经转换为草稿",
      409,
    );
  }
  await writeKnowledgeAudit(
    {
      userId: context.user.id,
      action: "knowledge_source_converted_to_draft",
      entityType: "knowledge_source",
      entityId: sourceId,
      ...meta,
      metadata: { articleId, status: "converted" },
    },
    db,
  );
}

export async function convertKnowledgeSourceToDraft(
  context: KnowledgeSessionContext,
  sourceId: string,
  input: {
    title: unknown;
    summary?: unknown;
    body: unknown;
    categoryId: unknown;
    visibility?: unknown;
    changeNote?: unknown;
  },
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
) {
  const source = await getSourceRow(context, sourceId, db);
  if (!canManageSource(context, source)) {
    throw sourceError(KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED, "来源转换权限不足", 403);
  }
  if (source.linkedArticleId || source.status === "converted") {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.SOURCE_ALREADY_CONVERTED,
      "此来源已经转换为草稿",
      409,
    );
  }
  if (source.status !== "organized") {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "来源尚未完成 AI 整理",
      409,
    );
  }
  const run = await latestOrganization(sourceId, db);
  if (
    !run ||
    run.status !== "completed" ||
    !run.proposedTitle ||
    !run.proposedBody
  ) {
    throw sourceError(
      KNOWLEDGE_ERROR_CODES.AI_OUTPUT_INVALID,
      "没有可供保存的 AI 整理结果",
      409,
    );
  }

  const values = parseArticleInput(input);
  const article = await createKnowledgeArticle(
    context,
    {
      title: values.title,
      categoryId: values.categoryId,
      summary: values.summary,
      body: values.body,
      visibility: values.visibility,
      changeNote: values.changeNote ?? "由 Knowledge 来源人工审核后建立",
    },
    meta,
    db,
  );
  await markKnowledgeSourceConverted(context, sourceId, article.id, meta, db);
  return article;
}

export function isKnowledgeSourceOwner(
  context: KnowledgeSessionContext,
  source: Pick<KnowledgeSource, "createdByUserId">,
): boolean {
  return canViewSource(context, source);
}
