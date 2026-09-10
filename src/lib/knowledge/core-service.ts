import {
  and,
  asc,
  desc,
  eq,
  ne,
  sql,
} from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import {
  KNOWLEDGE_ERROR_CODES,
  type KnowledgeVisibility,
} from "@/lib/knowledge/constants";
import { canViewKnowledgeVisibility } from "@/lib/knowledge/visibility";
import {
  buildKnowledgeAuditInsert,
  writeKnowledgeAudit,
  type KnowledgeAuditInput,
} from "@/lib/knowledge/audit";
import {
  canArchiveKnowledgeArticle,
  canAuthorKnowledgeArticle,
  canEditKnowledgeArticle,
} from "@/lib/knowledge/article-permissions";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import { hasActiveKnowledgeReview } from "@/lib/knowledge/review-state";

export const KNOWLEDGE_CATEGORY_NAME_MAX = 120;
export const KNOWLEDGE_CATEGORY_DESCRIPTION_MAX = 500;
export const KNOWLEDGE_ARTICLE_TITLE_MAX = 200;
export const KNOWLEDGE_ARTICLE_SUMMARY_MAX = 1_000;
export const KNOWLEDGE_ARTICLE_BODY_MAX = 100_000;
export const KNOWLEDGE_ARTICLE_CHANGE_NOTE_MAX = 500;

export type KnowledgeCategoryInput = {
  name: unknown;
  description?: unknown;
  sortOrder?: unknown;
};

export type KnowledgeArticleInput = {
  title: unknown;
  categoryId: unknown;
  summary?: unknown;
  body: unknown;
  visibility?: unknown;
  changeNote?: unknown;
  expectedUpdatedAt?: unknown;
};

export type KnowledgeCategoryListItem = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  articleCount: number;
  updatedAt: string;
};

export type KnowledgeArticleListItem = {
  id: string;
  categoryId: string;
  categoryName: string;
  title: string;
  summary: string | null;
  status: "draft" | "published" | "archived";
  visibility: KnowledgeVisibility;
  ownerUserId: string | null;
  currentVersionNumber: number;
  publishedVersionNumber: number | null;
  isPublishedSnapshot: boolean;
  hasUnpublishedChanges: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type KnowledgeArticleDetail = KnowledgeArticleListItem & {
  body: string;
};

export type KnowledgeArticleVersionView = {
  id: string;
  articleId: string;
  versionNumber: number;
  titleSnapshot: string;
  summarySnapshot: string | null;
  bodySnapshot: string;
  categoryIdSnapshot: string;
  visibilitySnapshot: KnowledgeVisibility;
  ownerUserIdSnapshot: string | null;
  changeNote: string | null;
  createdByUserId: string | null;
  createdAt: string;
};

function invalid(message: string): never {
  throw new KnowledgeServiceError(
    KNOWLEDGE_ERROR_CODES.ARTICLE_INVALID,
    message,
    400,
  );
}

function normalizeRequiredString(
  value: unknown,
  label: string,
  maxLength: number,
  errorCode: string = KNOWLEDGE_ERROR_CODES.ARTICLE_INVALID,
): string {
  if (typeof value !== "string") {
    throw new KnowledgeServiceError(errorCode, `${label}格式无效`, 400);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new KnowledgeServiceError(errorCode, `${label}不能为空`, 400);
  }
  if (normalized.length > maxLength) {
    throw new KnowledgeServiceError(
      errorCode,
      `${label}不可超过 ${maxLength} 个字符`,
      400,
    );
  }
  return normalized;
}

function normalizeOptionalString(
  value: unknown,
  label: string,
  maxLength: number,
  errorCode: string = KNOWLEDGE_ERROR_CODES.ARTICLE_INVALID,
): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new KnowledgeServiceError(errorCode, `${label}格式无效`, 400);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new KnowledgeServiceError(
      errorCode,
      `${label}不可超过 ${maxLength} 个字符`,
      400,
    );
  }
  return normalized || null;
}

function normalizeSortOrder(value: unknown): number {
  if (value == null || value === "") return 0;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1_000_000
  ) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "分类排序值无效",
      400,
    );
  }
  return value;
}

function normalizeVisibility(value: unknown): KnowledgeVisibility {
  if (value == null || value === "") return "team";
  if (value === "team" || value === "restricted" || value === "owner") {
    return value;
  }
  invalid("文章可见范围无效");
}

function normalizeChangeNote(value: unknown): string | null {
  return normalizeOptionalString(
    value,
    "修改说明",
    KNOWLEDGE_ARTICLE_CHANGE_NOTE_MAX,
  );
}

function categorySlug(name: string, id: string): string {
  const readable = name
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${readable || "category"}-${id.slice(0, 8)}`;
}

function nextUpdatedAt(previous: string): string {
  const previousMs = Date.parse(previous);
  const nowMs = Date.now();
  return new Date(Math.max(nowMs, Number.isFinite(previousMs) ? previousMs + 1 : nowMs)).toISOString();
}

function articleVisibility(
  article: {
    visibility: string;
    ownerUserId: string | null;
  },
): KnowledgeVisibility {
  if (
    article.visibility !== "team" &&
    article.visibility !== "restricted" &&
    article.visibility !== "owner"
  ) {
    return "restricted";
  }
  return article.visibility;
}

function versionVisibility(value: string): KnowledgeVisibility {
  return value === "restricted" || value === "owner" ? value : "team";
}

function canEditArticle(
  context: KnowledgeSessionContext,
  article: KnowledgeArticleDetail,
): boolean {
  return canEditKnowledgeArticle(context, article);
}

function canArchiveArticle(
  context: KnowledgeSessionContext,
  article: KnowledgeArticleDetail,
): boolean {
  return canArchiveKnowledgeArticle(context, article);
}

function assertArticleRead(
  context: KnowledgeSessionContext,
  article: KnowledgeArticleDetail,
): void {
  const readable = canViewKnowledgeVisibility({
    role: context.role ?? "viewer",
    visibility: articleVisibility(article),
    userId: context.user.id,
    ownerId: article.ownerUserId,
    hasRestrictedGrant: false,
  });
  if (!context.role || !readable) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND,
      "文章不存在或无法访问",
      404,
    );
  }
}

function mapArticle(
  row: typeof schema.knowledgeArticles.$inferSelect,
  categoryName: string,
): KnowledgeArticleListItem {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName,
    title: row.title,
    summary: row.summary,
    status: row.status,
    visibility: articleVisibility(row),
    ownerUserId: row.ownerUserId,
    currentVersionNumber: row.currentVersionNumber,
    publishedVersionNumber: row.publishedVersionNumber,
    isPublishedSnapshot: false,
    hasUnpublishedChanges:
      row.publishedVersionNumber != null &&
      row.currentVersionNumber > row.publishedVersionNumber,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

async function getArticleRow(
  articleId: string,
  db: Database,
): Promise<KnowledgeArticleDetail | null> {
  const rows = await db
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
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...mapArticle(row.article, row.categoryName),
    body: row.article.body,
  };
}

async function getPublishedArticleView(
  current: KnowledgeArticleDetail,
  context: KnowledgeSessionContext,
  db: Database,
): Promise<KnowledgeArticleDetail> {
  if (
    context.role !== "viewer" ||
    current.status === "archived" ||
    current.publishedVersionNumber == null
  ) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND,
      "文章不存在或无法访问",
      404,
    );
  }
  const rows = await db
    .select()
    .from(schema.knowledgeArticleVersions)
    .where(
      and(
        eq(schema.knowledgeArticleVersions.articleId, current.id),
        eq(
          schema.knowledgeArticleVersions.versionNumber,
          current.publishedVersionNumber,
        ),
      ),
    )
    .limit(1);
  const version = rows[0];
  if (
    !version ||
    !canViewKnowledgeVisibility({
      role: "viewer",
      visibility: versionVisibility(version.visibilitySnapshot),
      userId: context.user.id,
      ownerId: version.ownerUserIdSnapshot,
      hasRestrictedGrant: false,
    })
  ) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND,
      "文章不存在或无法访问",
      404,
    );
  }
  return {
    ...current,
    categoryId: version.categoryIdSnapshot,
    title: version.titleSnapshot,
    summary: version.summarySnapshot,
    body: version.bodySnapshot,
    status: "published",
    visibility: versionVisibility(version.visibilitySnapshot),
    ownerUserId: version.ownerUserIdSnapshot,
    currentVersionNumber: version.versionNumber,
    publishedVersionNumber: version.versionNumber,
    isPublishedSnapshot: true,
    hasUnpublishedChanges: false,
  };
}

async function getCategory(
  categoryId: string,
  db: Database,
): Promise<typeof schema.knowledgeCategories.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.knowledgeCategories)
    .where(eq(schema.knowledgeCategories.id, categoryId))
    .limit(1);
  return rows[0] ?? null;
}

function auditInsertWhenArticleMatches(
  db: Database,
  input: KnowledgeAuditInput,
  articleId: string,
  updatedAt: string,
  versionNumber?: number,
) {
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
  const versionGate =
    versionNumber == null
      ? sql``
      : sql` AND current_version_number = ${versionNumber}`;
  return db.insert(schema.auditLogs).select(sql`
    SELECT
      ${crypto.randomUUID()}, ${input.userId}, ${input.action},
      ${input.entityType}, ${input.entityId}, ${input.ipAddress ?? null},
      ${input.userAgent ?? null}, ${metadata}, ${new Date().toISOString()}
    WHERE EXISTS (
      SELECT 1 FROM knowledge_articles
      WHERE id = ${articleId}
        AND updated_at = ${updatedAt}
        ${versionGate}
    )
  `);
}

export function parseCategoryInput(input: KnowledgeCategoryInput): {
  name: string;
  description: string | null;
  sortOrder: number;
} {
  if (!input || typeof input !== "object") {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "分类资料无效",
      400,
    );
  }
  return {
    name: normalizeRequiredString(
      input.name,
      "分类名称",
      KNOWLEDGE_CATEGORY_NAME_MAX,
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
    ),
    description: normalizeOptionalString(
      input.description,
      "分类说明",
      KNOWLEDGE_CATEGORY_DESCRIPTION_MAX,
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
    ),
    sortOrder: normalizeSortOrder(input.sortOrder),
  };
}

export function parseArticleInput(input: KnowledgeArticleInput): {
  title: string;
  categoryId: string;
  summary: string | null;
  body: string;
  visibility: KnowledgeVisibility;
  changeNote: string | null;
  expectedUpdatedAt: string | null;
} {
  if (!input || typeof input !== "object") invalid("文章资料无效");
  const categoryId = normalizeRequiredString(input.categoryId, "文章分类", 100);
  const expectedUpdatedAt =
    input.expectedUpdatedAt == null
      ? null
      : normalizeRequiredString(input.expectedUpdatedAt, "文章版本", 100);
  return {
    title: normalizeRequiredString(input.title, "标题", KNOWLEDGE_ARTICLE_TITLE_MAX),
    categoryId,
    summary: normalizeOptionalString(
      input.summary,
      "摘要",
      KNOWLEDGE_ARTICLE_SUMMARY_MAX,
    ),
    body: normalizeRequiredString(
      input.body,
      "正文",
      KNOWLEDGE_ARTICLE_BODY_MAX,
    ),
    visibility: normalizeVisibility(input.visibility),
    changeNote: normalizeChangeNote(input.changeNote),
    expectedUpdatedAt,
  };
}

export async function listKnowledgeCategories(
  db: Database = getDb(),
): Promise<KnowledgeCategoryListItem[]> {
  const categories = await db
    .select()
    .from(schema.knowledgeCategories)
    .orderBy(asc(schema.knowledgeCategories.sortOrder), asc(schema.knowledgeCategories.name));
  const counts = await db
    .select({
      categoryId: schema.knowledgeArticles.categoryId,
      count: sql<number>`count(*)`,
    })
    .from(schema.knowledgeArticles)
    .where(ne(schema.knowledgeArticles.status, "archived"))
    .groupBy(schema.knowledgeArticles.categoryId);
  const countByCategory = new Map(
    counts.map((row) => [row.categoryId, Number(row.count)]),
  );
  return categories.map((category) => ({
    ...category,
    articleCount: countByCategory.get(category.id) ?? 0,
  }));
}

export async function listKnowledgeArticles(
  context: KnowledgeSessionContext,
  options: { categoryId?: string | null; includeArchived?: boolean } = {},
  db: Database = getDb(),
): Promise<KnowledgeArticleListItem[]> {
  const conditions = [];
  if (options.categoryId) {
    conditions.push(eq(schema.knowledgeArticles.categoryId, options.categoryId));
  }
  if (!options.includeArchived && context.role !== "knowledge_admin") {
    conditions.push(ne(schema.knowledgeArticles.status, "archived"));
  }
  const rows = await db
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
    .where(and(...conditions))
    .orderBy(desc(schema.knowledgeArticles.updatedAt));
  const visible: KnowledgeArticleListItem[] = [];
  for (const row of rows) {
    const current = {
      ...mapArticle(row.article, row.categoryName),
      body: row.article.body,
    };
    try {
      if (context.role === "viewer") {
        visible.push(await getPublishedArticleView(current, context, db));
        continue;
      }
      if (
        canViewKnowledgeVisibility({
          role: context.role ?? "viewer",
          visibility: current.visibility,
          userId: context.user.id,
          ownerId: current.ownerUserId,
          hasRestrictedGrant: false,
        })
      ) {
        visible.push(current);
      }
    } catch {
      // Unpublished drafts and inaccessible snapshots are omitted from lists.
    }
  }
  return visible;
}

export async function getKnowledgeCatalog(
  context: KnowledgeSessionContext,
  db: Database = getDb(),
) {
  const [categories, articles] = await Promise.all([
    listKnowledgeCategories(db),
    listKnowledgeArticles(context, { includeArchived: context.role === "knowledge_admin" }, db),
  ]);
  return { categories, articles };
}

export async function getKnowledgeArticle(
  context: KnowledgeSessionContext,
  articleId: string,
  db: Database = getDb(),
): Promise<KnowledgeArticleDetail> {
  const article = await getArticleRow(articleId, db);
  if (!article) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND,
      "文章不存在",
      404,
    );
  }
  if (context.role === "viewer") {
    return getPublishedArticleView(article, context, db);
  }
  assertArticleRead(context, article);
  return article;
}

export async function createKnowledgeCategory(
  context: KnowledgeSessionContext,
  input: KnowledgeCategoryInput,
  meta: Pick<KnowledgeAuditInput, "ipAddress" | "userAgent">,
  db: Database = getDb(),
): Promise<KnowledgeCategoryListItem> {
  if (context.role !== "knowledge_admin") {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED,
      "只有 Knowledge Admin 可以管理分类",
      403,
    );
  }
  const values = parseCategoryInput(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.insert(schema.knowledgeCategories).values({
      id,
      ...values,
      slug: categorySlug(values.name, id),
      isActive: true,
      createdByUserId: context.user.id,
      createdAt: now,
      updatedAt: now,
    }),
    buildKnowledgeAuditInsert(db, {
      userId: context.user.id,
      action: "knowledge_category_create",
      entityType: "knowledge_category",
      entityId: id,
      ...meta,
      metadata: { isActive: true },
    }),
  ]);
  const category = await getCategory(id, db);
  if (!category) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_NOT_FOUND,
      "分类建立失败",
      500,
    );
  }
  return {
    ...category,
    articleCount: 0,
  };
}

export async function updateKnowledgeCategory(
  context: KnowledgeSessionContext,
  categoryId: string,
  input: KnowledgeCategoryInput & { expectedUpdatedAt?: unknown; isActive?: unknown },
  meta: Pick<KnowledgeAuditInput, "ipAddress" | "userAgent">,
  db: Database = getDb(),
): Promise<KnowledgeCategoryListItem> {
  if (context.role !== "knowledge_admin") {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED,
      "只有 Knowledge Admin 可以管理分类",
      403,
    );
  }
  const current = await getCategory(categoryId, db);
  if (!current) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_NOT_FOUND,
      "分类不存在",
      404,
    );
  }
  const values = parseCategoryInput(input);
  const expectedUpdatedAt = normalizeRequiredString(
    input.expectedUpdatedAt,
    "分类版本",
    100,
  );
  const isActive =
    input.isActive == null ? current.isActive : input.isActive === true;
  const updatedAt = nextUpdatedAt(current.updatedAt);
  const update = db
    .update(schema.knowledgeCategories)
    .set({ ...values, isActive, updatedAt })
    .where(
      and(
        eq(schema.knowledgeCategories.id, categoryId),
        eq(schema.knowledgeCategories.updatedAt, expectedUpdatedAt),
      ),
    );
  await db.batch([
    update,
    db.insert(schema.auditLogs).select(sql`
      SELECT
        ${crypto.randomUUID()}, ${context.user.id}, 'knowledge_category_update',
        'knowledge_category', ${categoryId}, ${meta.ipAddress ?? null},
        ${meta.userAgent ?? null},
        ${JSON.stringify({ isActive })}, ${new Date().toISOString()}
      WHERE EXISTS (
        SELECT 1 FROM knowledge_categories
        WHERE id = ${categoryId} AND updated_at = ${updatedAt}
      )
    `),
  ]);
  const updated = await getCategory(categoryId, db);
  if (!updated || updated.updatedAt !== updatedAt) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_CONFLICT,
      "分类已被其他用户更新，请重新载入",
      409,
    );
  }
  const articles = await listKnowledgeArticles(context, { categoryId }, db);
  return {
    ...updated,
    articleCount: articles.length,
  };
}

export async function deleteKnowledgeCategory(
  context: KnowledgeSessionContext,
  categoryId: string,
  db: Database = getDb(),
): Promise<never> {
  if (context.role !== "knowledge_admin") {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED,
      "只有 Knowledge Admin 可以管理分类",
      403,
    );
  }
  const category = await getCategory(categoryId, db);
  if (!category) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_NOT_FOUND,
      "分类不存在",
      404,
    );
  }
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.knowledgeArticles)
    .where(eq(schema.knowledgeArticles.categoryId, categoryId));
  if (Number(rows[0]?.count ?? 0) > 0) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_HAS_ARTICLES,
      "已有文章的分类不能删除，请改为停用",
      409,
    );
  }
  throw new KnowledgeServiceError(
    KNOWLEDGE_ERROR_CODES.CATEGORY_DELETE_DISABLED,
    "分类不支持永久删除，请改为停用",
    405,
  );
}

export async function createKnowledgeArticle(
  context: KnowledgeSessionContext,
  input: KnowledgeArticleInput,
  meta: Pick<KnowledgeAuditInput, "ipAddress" | "userAgent">,
  db: Database = getDb(),
): Promise<KnowledgeArticleDetail> {
  if (!canAuthorKnowledgeArticle(context.role)) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED,
      "需要 Knowledge Contributor 权限",
      403,
    );
  }
  const values = parseArticleInput(input);
  const category = await getCategory(values.categoryId, db);
  if (!category || !category.isActive) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "请选择有效的启用分类",
      400,
    );
  }
  if (values.visibility === "restricted" && context.role !== "knowledge_admin") {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_ACCESS_DENIED,
      "Restricted 文章目前只能由 Knowledge Admin 建立",
      403,
    );
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ownerUserId = values.visibility === "owner" ? context.user.id : null;
  await db.batch([
    db.insert(schema.knowledgeArticles).values({
      id,
      categoryId: values.categoryId,
      title: values.title,
      summary: values.summary,
      body: values.body,
      status: "draft",
      visibility: values.visibility,
      ownerUserId,
      currentVersionNumber: 1,
      publishedVersionNumber: null,
      createdByUserId: context.user.id,
      updatedByUserId: context.user.id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }),
    db.insert(schema.knowledgeArticleVersions).values({
      id: crypto.randomUUID(),
      articleId: id,
      versionNumber: 1,
      titleSnapshot: values.title,
      summarySnapshot: values.summary,
      bodySnapshot: values.body,
      categoryIdSnapshot: values.categoryId,
      visibilitySnapshot: values.visibility,
      ownerUserIdSnapshot: ownerUserId,
      changeNote: values.changeNote,
      createdByUserId: context.user.id,
      createdAt: now,
    }),
    buildKnowledgeAuditInsert(db, {
      userId: context.user.id,
      action: "knowledge_article_create",
      entityType: "knowledge_article",
      entityId: id,
      ...meta,
      metadata: { versionNumber: 1, categoryId: values.categoryId },
    }),
  ]);
  const article = await getArticleRow(id, db);
  if (!article) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND,
      "文章建立失败",
      500,
    );
  }
  return article;
}

export async function updateKnowledgeArticle(
  context: KnowledgeSessionContext,
  articleId: string,
  input: KnowledgeArticleInput,
  meta: Pick<KnowledgeAuditInput, "ipAddress" | "userAgent">,
  db: Database = getDb(),
): Promise<KnowledgeArticleDetail> {
  const current = await getKnowledgeArticle(context, articleId, db);
  if (!canEditArticle(context, current)) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_EDITABLE,
      "只有可编辑的草稿文章可以更新",
      403,
    );
  }
  if (await hasActiveKnowledgeReview(articleId, db)) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_EDITABLE,
      "此版本正在审核中。如需修改，请先撤回审核",
      409,
    );
  }
  const values = parseArticleInput(input);
  if (!values.expectedUpdatedAt || values.expectedUpdatedAt !== current.updatedAt) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_CONFLICT,
      "文章已被其他用户更新，请重新载入",
      409,
    );
  }
  const category = await getCategory(values.categoryId, db);
  if (!category || !category.isActive) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "请选择有效的启用分类",
      400,
    );
  }
  if (values.visibility === "restricted" && context.role !== "knowledge_admin") {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_ACCESS_DENIED,
      "Restricted 文章目前只能由 Knowledge Admin 更新",
      403,
    );
  }
  const versionNumber = current.currentVersionNumber + 1;
  const updatedAt = nextUpdatedAt(current.updatedAt);
  const ownerUserId =
    values.visibility === "owner" ? current.ownerUserId ?? context.user.id : null;
  const update = db
    .update(schema.knowledgeArticles)
    .set({
      categoryId: values.categoryId,
      title: values.title,
      summary: values.summary,
      body: values.body,
      visibility: values.visibility,
      ownerUserId,
      currentVersionNumber: versionNumber,
      updatedByUserId: context.user.id,
      updatedAt,
    })
    .where(
      and(
        eq(schema.knowledgeArticles.id, articleId),
        eq(schema.knowledgeArticles.updatedAt, current.updatedAt),
        eq(
          schema.knowledgeArticles.currentVersionNumber,
          current.currentVersionNumber,
        ),
      ),
    );
  await db.batch([
    update,
    db.insert(schema.knowledgeArticleVersions).select(sql`
      SELECT
        ${crypto.randomUUID()}, ${articleId}, ${versionNumber}, ${values.title},
        ${values.summary}, ${values.body}, ${values.categoryId},
        ${values.visibility}, ${ownerUserId}, ${values.changeNote},
        ${context.user.id}, ${updatedAt}
      WHERE EXISTS (
        SELECT 1 FROM knowledge_articles
        WHERE id = ${articleId}
          AND updated_at = ${updatedAt}
          AND current_version_number = ${versionNumber}
      )
    `),
    auditInsertWhenArticleMatches(
      db,
      {
        userId: context.user.id,
        action: "knowledge_article_update",
        entityType: "knowledge_article",
        entityId: articleId,
        ...meta,
        metadata: { versionNumber },
      },
      articleId,
      updatedAt,
      versionNumber,
    ),
  ]);
  const updated = await getArticleRow(articleId, db);
  if (
    !updated ||
    updated.updatedAt !== updatedAt ||
    updated.currentVersionNumber !== versionNumber
  ) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_CONFLICT,
      "文章已被其他用户更新，请重新载入",
      409,
    );
  }
  return updated;
}

export async function archiveKnowledgeArticle(
  context: KnowledgeSessionContext,
  articleId: string,
  expectedUpdatedAt: string,
  meta: Pick<KnowledgeAuditInput, "ipAddress" | "userAgent">,
  db: Database = getDb(),
): Promise<KnowledgeArticleDetail> {
  const current = await getKnowledgeArticle(context, articleId, db);
  if (!canArchiveArticle(context, current)) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_ACCESS_DENIED,
      "没有归档此文章的权限",
      403,
    );
  }
  if (await hasActiveKnowledgeReview(articleId, db)) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_EDITABLE,
      "请先撤回或完成审核，再归档文章",
      409,
    );
  }
  const updatedAt = nextUpdatedAt(current.updatedAt);
  const archivedAt = new Date().toISOString();
  const update = db
    .update(schema.knowledgeArticles)
    .set({ status: "archived", archivedAt, updatedAt, updatedByUserId: context.user.id })
    .where(
      and(
        eq(schema.knowledgeArticles.id, articleId),
        eq(schema.knowledgeArticles.updatedAt, expectedUpdatedAt),
      ),
    );
  await db.batch([
    update,
    auditInsertWhenArticleMatches(
      db,
      {
        userId: context.user.id,
        action: "knowledge_article_archive",
        entityType: "knowledge_article",
        entityId: articleId,
        ...meta,
      },
      articleId,
      updatedAt,
    ),
  ]);
  const archived = await getArticleRow(articleId, db);
  if (!archived || archived.updatedAt !== updatedAt || archived.status !== "archived") {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_CONFLICT,
      "文章已被其他用户更新，请重新载入",
      409,
    );
  }
  return archived;
}

function mapVersion(
  row: typeof schema.knowledgeArticleVersions.$inferSelect,
): KnowledgeArticleVersionView {
  return {
    ...row,
    visibilitySnapshot:
      row.visibilitySnapshot === "restricted" || row.visibilitySnapshot === "owner"
        ? row.visibilitySnapshot
        : "team",
  };
}

export async function listKnowledgeArticleVersions(
  context: KnowledgeSessionContext,
  articleId: string,
  db: Database = getDb(),
): Promise<KnowledgeArticleVersionView[]> {
  const article = await getKnowledgeArticle(context, articleId, db);
  const rows = await db
    .select()
    .from(schema.knowledgeArticleVersions)
    .where(eq(schema.knowledgeArticleVersions.articleId, articleId))
    .orderBy(desc(schema.knowledgeArticleVersions.versionNumber));
  return rows
    .filter(
      (row) =>
        context.role !== "viewer" ||
        (article.publishedVersionNumber != null &&
          row.versionNumber <= article.publishedVersionNumber),
    )
    .map(mapVersion);
}

export async function getKnowledgeArticleVersion(
  context: KnowledgeSessionContext,
  articleId: string,
  versionNumber: number,
  meta: Pick<KnowledgeAuditInput, "ipAddress" | "userAgent">,
  db: Database = getDb(),
): Promise<KnowledgeArticleVersionView> {
  const article = await getKnowledgeArticle(context, articleId, db);
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND,
      "文章版本不存在",
      404,
    );
  }
  const rows = await db
    .select()
    .from(schema.knowledgeArticleVersions)
    .where(
      and(
        eq(schema.knowledgeArticleVersions.articleId, articleId),
        eq(schema.knowledgeArticleVersions.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  const version = rows[0];
  if (!version) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND,
      "文章版本不存在",
      404,
    );
  }
  if (
    context.role === "viewer" &&
    (article.publishedVersionNumber == null ||
      versionNumber > article.publishedVersionNumber ||
      !canViewKnowledgeVisibility({
        role: "viewer",
        visibility: versionVisibility(version.visibilitySnapshot),
        userId: context.user.id,
        ownerId: version.ownerUserIdSnapshot,
        hasRestrictedGrant: false,
      }))
  ) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND,
      "文章版本不存在",
      404,
    );
  }
  await writeKnowledgeAudit(
    {
      userId: context.user.id,
      action: "knowledge_article_view_version",
      entityType: "knowledge_article_version",
      entityId: version.id,
      ...meta,
      metadata: { articleId, versionNumber },
    },
    db,
  );
  return mapVersion(version);
}
