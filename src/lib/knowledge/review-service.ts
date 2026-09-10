import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import {
  KNOWLEDGE_ERROR_CODES,
  type KnowledgeVisibility,
} from "@/lib/knowledge/constants";
import {
  buildKnowledgeAuditInsert,
  type KnowledgeAuditInput,
} from "@/lib/knowledge/audit";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { canViewKnowledgeVisibility } from "@/lib/knowledge/visibility";
import { hasKnowledgeRoleAtLeast } from "@/lib/knowledge/role-service";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import type { KnowledgeReviewStatus } from "../../../drizzle/schema/knowledge-review-requests";

export type KnowledgeReviewListView = "pending" | "mine" | "history";

export type KnowledgeReviewListItem = {
  id: string;
  articleId: string;
  articleTitle: string;
  categoryName: string;
  submittedVersionNumber: number;
  submittedByUserId: string;
  submittedByName: string;
  assignedReviewerUserId: string | null;
  assignedReviewerName: string | null;
  status: KnowledgeReviewStatus;
  submissionNote: string | null;
  reviewNote: string | null;
  dueAt: string | null;
  submittedAt: string;
  decidedAt: string | null;
  visibility: KnowledgeVisibility;
  currentVersionNumber: number;
  publishedVersionNumber: number | null;
};

export type KnowledgeReviewDetail = KnowledgeReviewListItem & {
  reviewStartedAt: string | null;
  withdrawnAt: string | null;
  titleSnapshot: string;
  summarySnapshot: string | null;
  bodySnapshot: string;
  categoryIdSnapshot: string;
  ownerUserIdSnapshot: string | null;
  publication: {
    id: string;
    publishedByUserId: string;
    publishedAt: string;
  } | null;
};

export type KnowledgeReviewMeta = Pick<
  KnowledgeAuditInput,
  "ipAddress" | "userAgent"
>;

function reviewError(code: string, message: string, status = 400) {
  return new KnowledgeServiceError(code, message, status);
}

function requireSubmitRole(context: KnowledgeSessionContext): void {
  if (
    !context.role ||
    (context.role !== "contributor" && context.role !== "knowledge_admin")
  ) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "需要 Knowledge Contributor 权限",
      403,
    );
  }
}

function requireReviewListRole(context: KnowledgeSessionContext): void {
  if (
    !context.role ||
    context.role === "viewer"
  ) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "需要 Knowledge 审核访问权限",
      403,
    );
  }
}

function requireReviewerRole(context: KnowledgeSessionContext): void {
  if (
    context.role !== "reviewer" &&
    context.role !== "knowledge_admin"
  ) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "需要 Knowledge Reviewer 权限",
      403,
    );
  }
}

function normalizeNote(value: unknown, required = false): string | null {
  if (value == null || value === "") {
    if (required) {
      throw reviewError(
        KNOWLEDGE_ERROR_CODES.REVIEW_NOTE_REQUIRED,
        "请填写有意义的审核意见",
      );
    }
    return null;
  }
  if (typeof value !== "string") {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_INVALID, "审核意见格式无效");
  }
  const normalized = value.trim();
  if (required && normalized.length < 2) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_NOTE_REQUIRED,
      "请填写有意义的审核意见",
    );
  }
  if (normalized.length > 2_000) {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_INVALID, "审核意见过长");
  }
  return normalized || null;
}

function normalizeDueAt(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_INVALID, "审核到期时间无效");
  }
  return new Date(value).toISOString();
}

function canReadSnapshot(
  context: KnowledgeSessionContext,
  version: {
    visibilitySnapshot: string;
    ownerUserIdSnapshot: string | null;
  },
): boolean {
  if (!context.role || context.role === "viewer") return false;
  return canViewKnowledgeVisibility({
    role: context.role,
    visibility:
      version.visibilitySnapshot === "restricted" ||
      version.visibilitySnapshot === "owner"
        ? version.visibilitySnapshot
        : "team",
    userId: context.user.id,
    ownerId: version.ownerUserIdSnapshot,
    hasRestrictedGrant: false,
  });
}

async function getRawArticle(articleId: string, db: Database) {
  return (
    await db
      .select({
        article: schema.knowledgeArticles,
        categoryName: schema.knowledgeCategories.name,
      })
      .from(schema.knowledgeArticles)
      .innerJoin(
        schema.knowledgeCategories,
        eq(
          schema.knowledgeCategories.id,
          schema.knowledgeArticles.categoryId,
        ),
      )
      .where(eq(schema.knowledgeArticles.id, articleId))
      .limit(1)
  )[0] ?? null;
}

async function getVersion(
  articleId: string,
  versionNumber: number,
  db: Database,
) {
  return (
    await db
      .select()
      .from(schema.knowledgeArticleVersions)
      .where(
        and(
          eq(schema.knowledgeArticleVersions.articleId, articleId),
          eq(schema.knowledgeArticleVersions.versionNumber, versionNumber),
        ),
      )
      .limit(1)
  )[0] ?? null;
}

async function getUserName(userId: string | null, db: Database) {
  if (!userId) return null;
  const user = (
    await db
      .select({ displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
  )[0];
  return user?.displayName ?? null;
}

async function getPublication(
  reviewRequestId: string,
  db: Database,
): Promise<KnowledgeReviewDetail["publication"]> {
  const publication = (
    await db
      .select({
        id: schema.knowledgeArticlePublications.id,
        publishedByUserId: schema.knowledgeArticlePublications.publishedByUserId,
        publishedAt: schema.knowledgeArticlePublications.publishedAt,
      })
      .from(schema.knowledgeArticlePublications)
      .where(
        eq(
          schema.knowledgeArticlePublications.reviewRequestId,
          reviewRequestId,
        ),
      )
      .limit(1)
  )[0];
  return publication ?? null;
}

async function getReviewRecord(reviewRequestId: string, db: Database) {
  return (
    await db
      .select({
        request: schema.knowledgeReviewRequests,
        article: schema.knowledgeArticles,
        categoryName: schema.knowledgeCategories.name,
      })
      .from(schema.knowledgeReviewRequests)
      .innerJoin(
        schema.knowledgeArticles,
        eq(
          schema.knowledgeArticles.id,
          schema.knowledgeReviewRequests.articleId,
        ),
      )
      .innerJoin(
        schema.knowledgeCategories,
        eq(
          schema.knowledgeCategories.id,
          schema.knowledgeArticles.categoryId,
        ),
      )
      .where(eq(schema.knowledgeReviewRequests.id, reviewRequestId))
      .limit(1)
  )[0] ?? null;
}

async function assertReviewAccess(
  context: KnowledgeSessionContext,
  record: NonNullable<Awaited<ReturnType<typeof getReviewRecord>>>,
  version: NonNullable<Awaited<ReturnType<typeof getVersion>>>,
): Promise<void> {
  const isSubmitter =
    record.request.submittedByUserId === context.user.id &&
    context.role != null &&
    hasKnowledgeRoleAtLeast(context.role, "contributor");
  const isAssignedReviewer =
    record.request.assignedReviewerUserId === context.user.id &&
    (context.role === "reviewer" || context.role === "knowledge_admin");
  const isUnassignedReviewer =
    record.request.assignedReviewerUserId == null &&
    (context.role === "reviewer" || context.role === "knowledge_admin") &&
    record.request.submittedByUserId !== context.user.id;
  if (
    !isSubmitter &&
    !isAssignedReviewer &&
    !isUnassignedReviewer &&
    context.role !== "knowledge_admin"
  ) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "无权访问此审核记录",
      403,
    );
  }
  if (!canReadSnapshot(context, version)) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "无权访问此文章版本",
      403,
    );
  }
}

async function toDetail(
  context: KnowledgeSessionContext,
  record: NonNullable<Awaited<ReturnType<typeof getReviewRecord>>>,
  db: Database,
  enforceAccess = true,
): Promise<KnowledgeReviewDetail> {
  const version = await getVersion(
    record.request.articleId,
    record.request.submittedVersionNumber,
    db,
  );
  if (!version) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT,
      "审核版本不存在",
      409,
    );
  }
  if (enforceAccess) await assertReviewAccess(context, record, version);
  const [submittedByName, assignedReviewerName] = await Promise.all([
    getUserName(record.request.submittedByUserId, db),
    getUserName(record.request.assignedReviewerUserId, db),
  ]);
  return {
    id: record.request.id,
    articleId: record.request.articleId,
    articleTitle: version.titleSnapshot,
    categoryName: record.categoryName,
    submittedVersionNumber: record.request.submittedVersionNumber,
    submittedByUserId: record.request.submittedByUserId,
    submittedByName: submittedByName ?? "Unknown",
    assignedReviewerUserId: record.request.assignedReviewerUserId,
    assignedReviewerName: assignedReviewerName,
    status: record.request.status,
    submissionNote: record.request.submissionNote,
    reviewNote: record.request.reviewNote,
    dueAt: record.request.dueAt,
    submittedAt: record.request.submittedAt,
    decidedAt: record.request.decidedAt,
    visibility:
      version.visibilitySnapshot === "restricted" ||
      version.visibilitySnapshot === "owner"
        ? version.visibilitySnapshot
        : "team",
    currentVersionNumber: record.article.currentVersionNumber,
    publishedVersionNumber: record.article.publishedVersionNumber,
    reviewStartedAt: record.request.reviewStartedAt,
    withdrawnAt: record.request.withdrawnAt,
    titleSnapshot: version.titleSnapshot,
    summarySnapshot: version.summarySnapshot,
    bodySnapshot: version.bodySnapshot,
    categoryIdSnapshot: version.categoryIdSnapshot,
    ownerUserIdSnapshot: version.ownerUserIdSnapshot,
    publication: await getPublication(record.request.id, db),
  };
}

export async function getKnowledgeReviewRequest(
  context: KnowledgeSessionContext,
  reviewRequestId: string,
  db: Database = getDb(),
): Promise<KnowledgeReviewDetail> {
  const record = await getReviewRecord(reviewRequestId, db);
  if (!record) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_NOT_FOUND,
      "审核记录不存在",
      404,
    );
  }
  return toDetail(context, record, db);
}

export async function listKnowledgeReviewRequests(
  context: KnowledgeSessionContext,
  view: KnowledgeReviewListView,
  db: Database = getDb(),
): Promise<KnowledgeReviewListItem[]> {
  if (view === "pending") requireReviewerRole(context);
  if (view !== "pending") requireReviewListRole(context);
  const requests = await db
    .select({ id: schema.knowledgeReviewRequests.id })
    .from(schema.knowledgeReviewRequests)
    .where(
      view === "pending"
        ? eq(schema.knowledgeReviewRequests.status, "pending")
        : view === "mine"
          ? eq(
              schema.knowledgeReviewRequests.submittedByUserId,
              context.user.id,
            )
          : inArray(schema.knowledgeReviewRequests.status, [
              "changes_requested",
              "approved",
              "withdrawn",
              "superseded",
            ]),
    )
    .orderBy(desc(schema.knowledgeReviewRequests.updatedAt));
  const result: KnowledgeReviewListItem[] = [];
  for (const row of requests) {
    const record = await getReviewRecord(row.id, db);
    if (!record) continue;
    if (
      view === "pending" &&
      record.request.submittedByUserId === context.user.id
    ) {
      continue;
    }
    try {
      const detail = await toDetail(context, record, db);
      if (
        view === "pending" &&
        record.request.assignedReviewerUserId != null &&
        record.request.assignedReviewerUserId !== context.user.id &&
        context.role !== "knowledge_admin"
      ) {
        continue;
      }
      result.push(detail);
    } catch {
      // Inaccessible restricted/owner items are intentionally omitted.
    }
  }
  return result;
}

export type KnowledgeArticleReviewSummary = {
  id: string;
  status: KnowledgeReviewStatus;
  submittedVersionNumber: number;
  submittedByUserId: string;
  submissionNote: string | null;
  reviewNote: string | null;
  submittedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  assignedReviewerName: string | null;
};

export function isActiveArticleReviewForCurrentVersion(
  status: KnowledgeReviewStatus,
  submittedVersionNumber: number,
  currentVersionNumber: number,
): boolean {
  if (submittedVersionNumber !== currentVersionNumber) return false;
  return status === "pending" || status === "changes_requested";
}

export async function getArticleReviewSummaryForViewer(
  context: KnowledgeSessionContext,
  articleId: string,
  db: Database = getDb(),
): Promise<KnowledgeArticleReviewSummary | null> {
  if (
    !context.role ||
    context.role === "viewer" ||
    context.role === "reviewer"
  ) {
    return null;
  }

  const articleRecord = await getRawArticle(articleId, db);
  if (!articleRecord) return null;
  const currentVersionNumber = articleRecord.article.currentVersionNumber;

  const requests = await db
    .select({ id: schema.knowledgeReviewRequests.id })
    .from(schema.knowledgeReviewRequests)
    .where(
      and(
        eq(schema.knowledgeReviewRequests.articleId, articleId),
        context.role === "knowledge_admin"
          ? sql`1 = 1`
          : eq(
              schema.knowledgeReviewRequests.submittedByUserId,
              context.user.id,
            ),
      ),
    )
    .orderBy(desc(schema.knowledgeReviewRequests.updatedAt))
    .limit(10);

  for (const row of requests) {
    const record = await getReviewRecord(row.id, db);
    if (!record) continue;
    if (
      !isActiveArticleReviewForCurrentVersion(
        record.request.status,
        record.request.submittedVersionNumber,
        currentVersionNumber,
      )
    ) {
      continue;
    }
    const version = await getVersion(
      record.request.articleId,
      record.request.submittedVersionNumber,
      db,
    );
    if (!version) continue;
    try {
      await assertReviewAccess(context, record, version);
    } catch {
      continue;
    }
    const [decidedByName, assignedReviewerName] = await Promise.all([
      getUserName(record.request.decidedByUserId, db),
      getUserName(record.request.assignedReviewerUserId, db),
    ]);
    return {
      id: record.request.id,
      status: record.request.status,
      submittedVersionNumber: record.request.submittedVersionNumber,
      submittedByUserId: record.request.submittedByUserId,
      submissionNote: record.request.submissionNote,
      reviewNote: record.request.reviewNote,
      submittedAt: record.request.submittedAt,
      decidedAt: record.request.decidedAt,
      decidedByName,
      assignedReviewerName,
    };
  }

  return null;
}

export async function submitKnowledgeReview(
  context: KnowledgeSessionContext,
  input: {
    articleId: unknown;
    submissionNote?: unknown;
    dueAt?: unknown;
  },
  meta: KnowledgeReviewMeta,
  db: Database = getDb(),
): Promise<KnowledgeReviewDetail> {
  requireSubmitRole(context);
  if (typeof input.articleId !== "string" || !input.articleId.trim()) {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_INVALID, "文章资料无效");
  }
  const articleId = input.articleId.trim();
  const note = normalizeNote(input.submissionNote);
  const dueAt = normalizeDueAt(input.dueAt);
  const record = await getRawArticle(articleId, db);
  if (!record) {
    throw reviewError(KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND, "文章不存在", 404);
  }
  if (record.article.status === "archived") {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ARCHIVED,
      "已归档文章不能提交审核",
      409,
    );
  }
  if (
    !canViewKnowledgeVisibility({
      role: context.role!,
      visibility: record.article.visibility,
      userId: context.user.id,
      ownerId: record.article.ownerUserId,
      hasRestrictedGrant: false,
    })
  ) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "无权提交此文章审核",
      403,
    );
  }
  const version = await getVersion(
    articleId,
    record.article.currentVersionNumber,
    db,
  );
  if (!version) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT,
      "当前文章版本不存在",
      409,
    );
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.insert(schema.knowledgeReviewRequests).values({
        id,
        articleId,
        submittedVersionNumber: record.article.currentVersionNumber,
        submittedByUserId: context.user.id,
        assignedReviewerUserId: null,
        status: "pending",
        submissionNote: note,
        reviewNote: null,
        dueAt,
        submittedAt: now,
        reviewStartedAt: null,
        decidedAt: null,
        decidedByUserId: null,
        withdrawnAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      buildKnowledgeAuditInsert(db, {
        userId: context.user.id,
        action: "knowledge_review_submitted",
        entityType: "knowledge_review_request",
        entityId: id,
        ...meta,
        metadata: {
          articleId,
          submittedVersionNumber: record.article.currentVersionNumber,
          status: "pending",
        },
      }),
    ]);
  } catch {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT,
      "此文章已有进行中的审核",
      409,
    );
  }
  return getKnowledgeReviewRequest(context, id, db);
}

async function assertReviewerCanAct(
  context: KnowledgeSessionContext,
  record: NonNullable<Awaited<ReturnType<typeof getReviewRecord>>>,
  version: NonNullable<Awaited<ReturnType<typeof getVersion>>>,
): Promise<void> {
  requireReviewerRole(context);
  await assertReviewAccess(context, record, version);
  if (
    record.request.assignedReviewerUserId != null &&
    record.request.assignedReviewerUserId !== context.user.id &&
    context.role !== "knowledge_admin"
  ) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "此审核已分配给其他 Reviewer",
      403,
    );
  }
  if (record.request.submittedByUserId === context.user.id) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_SELF_APPROVAL,
      "提交者不能审核自己的文章",
      403,
    );
  }
}

export async function assignKnowledgeReview(
  context: KnowledgeSessionContext,
  reviewRequestId: string,
  reviewerUserId: unknown,
  meta: KnowledgeReviewMeta,
  db: Database = getDb(),
): Promise<KnowledgeReviewDetail> {
  if (context.role !== "knowledge_admin") {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "只有 Knowledge Admin 可以分配审核",
      403,
    );
  }
  if (typeof reviewerUserId !== "string" || !reviewerUserId.trim()) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ASSIGNMENT_INVALID,
      "Reviewer 资料无效",
    );
  }
  const record = await getReviewRecord(reviewRequestId, db);
  if (!record) {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_NOT_FOUND, "审核记录不存在", 404);
  }
  const version = await getVersion(
    record.request.articleId,
    record.request.submittedVersionNumber,
    db,
  );
  if (!version || !canReadSnapshot(context, version)) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "无权分配此审核",
      403,
    );
  }
  const target = (
    await db
      .select({
        id: schema.users.id,
        isActive: schema.users.isActive,
        deletedAt: schema.users.deletedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, reviewerUserId.trim()))
      .limit(1)
  )[0];
  const targetRole = target
    ? (
        await db
          .select({ role: schema.knowledgeUserRoles.role })
          .from(schema.knowledgeUserRoles)
          .where(eq(schema.knowledgeUserRoles.userId, target.id))
          .limit(1)
      )[0]?.role
    : null;
  if (
    !target ||
    target.isActive !== 1 ||
    target.deletedAt != null ||
    (targetRole !== "reviewer" && targetRole !== "knowledge_admin") ||
    target.id === record.request.submittedByUserId ||
    !canViewKnowledgeVisibility({
      role: targetRole,
      visibility: canReadSnapshot(context, version)
        ? version.visibilitySnapshot === "restricted" ||
          version.visibilitySnapshot === "owner"
          ? version.visibilitySnapshot
          : "team"
        : "restricted",
      userId: target.id,
      ownerId: version.ownerUserIdSnapshot,
      hasRestrictedGrant: false,
    })
  ) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ASSIGNMENT_INVALID,
      "Reviewer 不符合文章可见范围或角色要求",
      403,
    );
  }
  if (record.request.status !== "pending") {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT,
      "只有待审核记录可以分配",
      409,
    );
  }
  const updatedAt = new Date().toISOString();
  await db.batch([
    db
      .update(schema.knowledgeReviewRequests)
      .set({
        assignedReviewerUserId: target.id,
        reviewStartedAt: record.request.reviewStartedAt ?? updatedAt,
        updatedAt,
      })
      .where(
        and(
          eq(schema.knowledgeReviewRequests.id, reviewRequestId),
          eq(schema.knowledgeReviewRequests.status, "pending"),
          sql`EXISTS (
            SELECT 1 FROM knowledge_articles
            WHERE id = ${record.request.articleId}
              AND status <> 'archived'
              AND current_version_number = ${record.request.submittedVersionNumber}
          )`,
        ),
      ),
    db.insert(schema.auditLogs).select(sql`
      SELECT
        ${crypto.randomUUID()},
        ${context.user.id},
        'knowledge_review_assigned',
        'knowledge_review_request',
        ${reviewRequestId},
        ${meta.ipAddress ?? null},
        ${meta.userAgent ?? null},
        ${JSON.stringify({ reviewerUserId: target.id, status: "pending" })},
        ${updatedAt}
      WHERE EXISTS (
        SELECT 1 FROM knowledge_review_requests
        WHERE id = ${reviewRequestId}
          AND status = 'pending'
          AND assigned_reviewer_user_id = ${target.id}
          AND updated_at = ${updatedAt}
      )
    `),
  ]);
  return getKnowledgeReviewRequest(context, reviewRequestId, db);
}

export async function requestKnowledgeReviewChanges(
  context: KnowledgeSessionContext,
  reviewRequestId: string,
  reviewNote: unknown,
  meta: KnowledgeReviewMeta,
  db: Database = getDb(),
): Promise<KnowledgeReviewDetail> {
  const record = await getReviewRecord(reviewRequestId, db);
  if (!record) {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_NOT_FOUND, "审核记录不存在", 404);
  }
  const version = await getVersion(
    record.request.articleId,
    record.request.submittedVersionNumber,
    db,
  );
  if (!version) throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT, "审核版本不存在", 409);
  if (record.request.status === "changes_requested") {
    return getKnowledgeReviewRequest(context, reviewRequestId, db);
  }
  if (record.request.status !== "pending") {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT, "审核已经结束", 409);
  }
  await assertReviewerCanAct(context, record, version);
  const note = normalizeNote(reviewNote, true)!;
  const now = new Date().toISOString();
  await db.batch([
    db
      .update(schema.knowledgeReviewRequests)
      .set({
        status: "changes_requested",
        reviewNote: note,
        decidedAt: now,
        decidedByUserId: context.user.id,
        reviewStartedAt: record.request.reviewStartedAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.knowledgeReviewRequests.id, reviewRequestId),
          eq(schema.knowledgeReviewRequests.status, "pending"),
        ),
      ),
    db.insert(schema.auditLogs).select(sql`
      SELECT
        ${crypto.randomUUID()},
        ${context.user.id},
        'knowledge_review_changes_requested',
        'knowledge_review_request',
        ${reviewRequestId},
        ${meta.ipAddress ?? null},
        ${meta.userAgent ?? null},
        ${JSON.stringify({
          articleId: record.request.articleId,
          submittedVersionNumber: record.request.submittedVersionNumber,
          status: "changes_requested",
        })},
        ${now}
      WHERE EXISTS (
        SELECT 1 FROM knowledge_review_requests
        WHERE id = ${reviewRequestId}
          AND status = 'changes_requested'
          AND decided_by_user_id = ${context.user.id}
          AND decided_at = ${now}
      )
    `),
  ]);
  return getKnowledgeReviewRequest(context, reviewRequestId, db);
}

async function supersedeStaleReview(
  context: KnowledgeSessionContext,
  reviewRequestId: string,
  meta: KnowledgeReviewMeta,
  db: Database,
) {
  const now = new Date().toISOString();
  await db.batch([
    db
      .update(schema.knowledgeReviewRequests)
      .set({ status: "superseded", decidedAt: now, decidedByUserId: context.user.id, updatedAt: now })
      .where(
        and(
          eq(schema.knowledgeReviewRequests.id, reviewRequestId),
          eq(schema.knowledgeReviewRequests.status, "pending"),
        ),
      ),
    db.insert(schema.auditLogs).select(sql`
      SELECT
        ${crypto.randomUUID()},
        ${context.user.id},
        'knowledge_review_changes_requested',
        'knowledge_review_request',
        ${reviewRequestId},
        ${meta.ipAddress ?? null},
        ${meta.userAgent ?? null},
        ${JSON.stringify({ status: "superseded" })},
        ${now}
      WHERE EXISTS (
        SELECT 1 FROM knowledge_review_requests
        WHERE id = ${reviewRequestId}
          AND status = 'superseded'
          AND decided_by_user_id = ${context.user.id}
          AND decided_at = ${now}
      )
    `),
  ]);
}

export async function approveAndPublishKnowledgeReview(
  context: KnowledgeSessionContext,
  reviewRequestId: string,
  meta: KnowledgeReviewMeta,
  db: Database = getDb(),
): Promise<KnowledgeReviewDetail> {
  const record = await getReviewRecord(reviewRequestId, db);
  if (!record) {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_NOT_FOUND, "审核记录不存在", 404);
  }
  if (record.request.status === "approved") {
    const existing = await getPublication(reviewRequestId, db);
    if (existing) return getKnowledgeReviewRequest(context, reviewRequestId, db);
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT, "发布记录不完整", 409);
  }
  if (record.request.status !== "pending") {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT, "审核已经结束", 409);
  }
  const version = await getVersion(
    record.request.articleId,
    record.request.submittedVersionNumber,
    db,
  );
  if (!version) throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT, "审核版本不存在", 409);
  await assertReviewerCanAct(context, record, version);
  if (
    record.article.status === "archived" ||
    record.article.currentVersionNumber !== record.request.submittedVersionNumber
  ) {
    await supersedeStaleReview(context, reviewRequestId, meta, db);
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT,
      "审核版本已过期，不能发布",
      409,
    );
  }
  const now = new Date().toISOString();
  const publicationId = crypto.randomUUID();
  await db.batch([
    db
      .update(schema.knowledgeReviewRequests)
      .set({
        status: "approved",
        decidedAt: now,
        decidedByUserId: context.user.id,
        reviewStartedAt: record.request.reviewStartedAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.knowledgeReviewRequests.id, reviewRequestId),
          eq(schema.knowledgeReviewRequests.status, "pending"),
          sql`EXISTS (
            SELECT 1 FROM knowledge_articles
            WHERE id = ${record.request.articleId}
              AND status <> 'archived'
              AND current_version_number = ${record.request.submittedVersionNumber}
          )`,
        ),
      ),
    db
      .update(schema.knowledgeArticles)
      .set({
        status: "published",
        publishedVersionNumber: record.request.submittedVersionNumber,
        updatedAt: now,
        updatedByUserId: context.user.id,
      })
      .where(
        and(
          eq(schema.knowledgeArticles.id, record.request.articleId),
          or(
            eq(schema.knowledgeArticles.status, "published"),
            eq(schema.knowledgeArticles.status, "draft"),
          ),
          eq(
            schema.knowledgeArticles.currentVersionNumber,
            record.request.submittedVersionNumber,
          ),
          sql`EXISTS (
            SELECT 1 FROM knowledge_review_requests
            WHERE id = ${reviewRequestId}
              AND status = 'approved'
              AND decided_by_user_id = ${context.user.id}
          )`,
        ),
      ),
    db.insert(schema.knowledgeArticlePublications).select(sql`
      SELECT
        ${publicationId},
        ${record.request.articleId},
        ${record.request.submittedVersionNumber},
        ${reviewRequestId},
        ${context.user.id},
        ${now},
        ${now}
      WHERE EXISTS (
        SELECT 1 FROM knowledge_review_requests
        WHERE id = ${reviewRequestId} AND status = 'approved'
      )
      AND EXISTS (
        SELECT 1 FROM knowledge_articles
        WHERE id = ${record.request.articleId}
          AND published_version_number = ${record.request.submittedVersionNumber}
          AND current_version_number = ${record.request.submittedVersionNumber}
      )
    `),
    db.insert(schema.auditLogs).select(sql`
      SELECT
        ${crypto.randomUUID()},
        ${context.user.id},
        'knowledge_review_approved',
        'knowledge_review_request',
        ${reviewRequestId},
        ${meta.ipAddress ?? null},
        ${meta.userAgent ?? null},
        ${JSON.stringify({
          articleId: record.request.articleId,
          submittedVersionNumber: record.request.submittedVersionNumber,
          status: "approved",
        })},
        ${now}
      WHERE EXISTS (
        SELECT 1 FROM knowledge_article_publications
        WHERE id = ${publicationId}
      )
    `),
    db.insert(schema.auditLogs).select(sql`
      SELECT
        ${crypto.randomUUID()},
        ${context.user.id},
        'knowledge_article_published',
        'knowledge_article',
        ${record.request.articleId},
        ${meta.ipAddress ?? null},
        ${meta.userAgent ?? null},
        ${JSON.stringify({
          reviewRequestId,
          versionNumber: record.request.submittedVersionNumber,
        })},
        ${now}
      WHERE EXISTS (
        SELECT 1 FROM knowledge_article_publications
        WHERE id = ${publicationId}
      )
    `),
  ]);
  if (!(await getPublication(reviewRequestId, db))) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT,
      "发布事务未完成",
      409,
    );
  }
  return getKnowledgeReviewRequest(context, reviewRequestId, db);
}

export async function withdrawKnowledgeReview(
  context: KnowledgeSessionContext,
  reviewRequestId: string,
  meta: KnowledgeReviewMeta,
  db: Database = getDb(),
): Promise<KnowledgeReviewDetail> {
  const record = await getReviewRecord(reviewRequestId, db);
  if (!record) {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_NOT_FOUND, "审核记录不存在", 404);
  }
  if (record.request.status === "withdrawn") {
    return getKnowledgeReviewRequest(context, reviewRequestId, db);
  }
  if (record.request.status !== "pending") {
    throw reviewError(KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT, "只有待审核记录可以撤回", 409);
  }
  if (
    record.request.submittedByUserId !== context.user.id &&
    context.role !== "knowledge_admin"
  ) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "只有提交者或 Knowledge Admin 可以撤回",
      403,
    );
  }
  const now = new Date().toISOString();
  await db.batch([
    db
      .update(schema.knowledgeReviewRequests)
      .set({
        status: "withdrawn",
        withdrawnAt: now,
        decidedAt: null,
        decidedByUserId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.knowledgeReviewRequests.id, reviewRequestId),
          eq(schema.knowledgeReviewRequests.status, "pending"),
        ),
      ),
    db.insert(schema.auditLogs).select(sql`
      SELECT
        ${crypto.randomUUID()},
        ${context.user.id},
        'knowledge_review_withdrawn',
        'knowledge_review_request',
        ${reviewRequestId},
        ${meta.ipAddress ?? null},
        ${meta.userAgent ?? null},
        ${JSON.stringify({
          articleId: record.request.articleId,
          submittedVersionNumber: record.request.submittedVersionNumber,
          status: "withdrawn",
        })},
        ${now}
      WHERE EXISTS (
        SELECT 1 FROM knowledge_review_requests
        WHERE id = ${reviewRequestId}
          AND status = 'withdrawn'
          AND withdrawn_at = ${now}
      )
    `),
  ]);
  return getKnowledgeReviewRequest(context, reviewRequestId, db);
}

export function knowledgeReviewDueState(
  dueAt: string | null,
  now = new Date(),
): "none" | "normal" | "soon" | "overdue" {
  if (!dueAt) return "none";
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return "none";
  const remaining = due - now.getTime();
  if (remaining < 0) return "overdue";
  if (remaining <= 48 * 60 * 60 * 1000) return "soon";
  return "normal";
}

export async function listKnowledgeArticlePublications(
  context: KnowledgeSessionContext,
  articleId: string,
  db: Database = getDb(),
) {
  const article = await getRawArticle(articleId, db);
  if (!article) {
    throw reviewError(KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND, "文章不存在", 404);
  }
  if (context.role === "viewer") {
    const publishedVersion =
      article.article.publishedVersionNumber == null
        ? null
        : await getVersion(
            articleId,
            article.article.publishedVersionNumber,
            db,
          );
    if (
      article.article.status === "archived" ||
      !publishedVersion ||
      !canViewKnowledgeVisibility({
        role: "viewer",
        visibility:
          publishedVersion.visibilitySnapshot === "restricted" ||
          publishedVersion.visibilitySnapshot === "owner"
            ? publishedVersion.visibilitySnapshot
            : "team",
        userId: context.user.id,
        ownerId: publishedVersion.ownerUserIdSnapshot,
        hasRestrictedGrant: false,
      })
    ) {
      throw reviewError(
        KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND,
        "文章不存在或无法访问",
        404,
      );
    }
  } else if (
    !context.role ||
    !canViewKnowledgeVisibility({
      role: context.role,
      visibility:
        article.article.visibility === "restricted" ||
        article.article.visibility === "owner"
          ? article.article.visibility
          : "team",
      userId: context.user.id,
      ownerId: article.article.ownerUserId,
      hasRestrictedGrant: false,
    })
  ) {
    throw reviewError(
      KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED,
      "无权访问发布记录",
      403,
    );
  }
  const rows = await db
    .select()
    .from(schema.knowledgeArticlePublications)
    .where(eq(schema.knowledgeArticlePublications.articleId, articleId))
    .orderBy(desc(schema.knowledgeArticlePublications.versionNumber));
  const visible =
    context.role === "viewer"
      ? rows.filter(
          (row) =>
            article.article.publishedVersionNumber != null &&
            row.versionNumber <= article.article.publishedVersionNumber,
        )
      : rows;
  return Promise.all(
    visible.map(async (row) => ({
      ...row,
      publishedByName: (await getUserName(row.publishedByUserId, db)) ?? "Unknown",
    })),
  );
}
