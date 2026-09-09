import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES, type KnowledgeVisibility } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { canViewKnowledgeVisibility } from "@/lib/knowledge/visibility";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";

export const KNOWLEDGE_SEARCH_QUERY_MAX_CHARS = 200;
export const KNOWLEDGE_SEARCH_RESULT_MAX = 20;
export const KNOWLEDGE_AI_SOURCE_MAX = 8;
export const KNOWLEDGE_AI_SOURCE_TEXT_MAX_CHARS = 6_000;

export type PublishedKnowledgeDocument = {
  articleId: string;
  versionNumber: number;
  citationId: string;
  title: string;
  summary: string | null;
  body: string;
  categoryId: string;
  categoryName: string;
  visibility: KnowledgeVisibility;
  ownerUserId: string | null;
};

export type KnowledgeSearchResult = Omit<
  PublishedKnowledgeDocument,
  "body"
> & {
  snippet: string;
};

function normalizeQuery(query: unknown): string {
  if (typeof query !== "string") {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.SEARCH_INVALID,
      "搜索内容格式无效",
      400,
    );
  }
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > KNOWLEDGE_SEARCH_QUERY_MAX_CHARS) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.SEARCH_INVALID,
      "搜索内容长度无效",
      400,
    );
  }
  return normalized;
}

function queryTokens(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLocaleLowerCase()
        .match(/[\p{Letter}\p{Number}]+/gu)
        ?.map((token) => token.slice(0, 60)) ?? [],
    ),
  ).slice(0, 8);
}

function publishedVisibilityCondition(context: KnowledgeSessionContext) {
  if (context.role === "knowledge_admin") return sql`1 = 1`;
  return or(
    eq(schema.knowledgeArticleVersions.visibilitySnapshot, "team"),
    and(
      eq(schema.knowledgeArticleVersions.visibilitySnapshot, "owner"),
      eq(
        schema.knowledgeArticleVersions.ownerUserIdSnapshot,
        context.user.id,
      ),
    ),
  );
}

function normalizeVisibility(value: string): KnowledgeVisibility {
  return value === "restricted" || value === "owner" ? value : "team";
}

function scoreDocument(document: PublishedKnowledgeDocument, query: string, tokens: string[]) {
  const title = document.title.toLocaleLowerCase();
  const summary = (document.summary ?? "").toLocaleLowerCase();
  const body = document.body.toLocaleLowerCase();
  const category = document.categoryName.toLocaleLowerCase();
  let score = title === query.toLocaleLowerCase() ? 10_000 : 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 1_000;
    if (summary.includes(token)) score += 300;
    if (body.includes(token)) score += 100;
    if (category.includes(token)) score += 50;
  }
  return score;
}

function excerpt(document: PublishedKnowledgeDocument, query: string): string {
  const haystack = `${document.title}\n${document.summary ?? ""}\n${document.body}`;
  const lower = haystack.toLocaleLowerCase();
  const matchIndex = lower.indexOf(query.toLocaleLowerCase());
  const start = matchIndex >= 0 ? Math.max(0, matchIndex - 100) : 0;
  const value = haystack.slice(start, start + 280).trim();
  return start > 0 ? `…${value}` : value;
}

function boundedBody(body: string, query: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  const tokens = queryTokens(query);
  const lowerBody = body.toLocaleLowerCase();
  const matchIndex = tokens
    .map((token) => lowerBody.indexOf(token))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const center = matchIndex ?? 0;
  const start = Math.max(0, Math.min(center - Math.floor(maxChars / 3), body.length - maxChars));
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxChars < body.length ? "…" : "";
  return `${prefix}${body.slice(start, start + maxChars)}${suffix}`;
}

export function normalizeKnowledgeQuery(query: unknown): string {
  return normalizeQuery(query);
}

export async function retrievePublishedKnowledge(
  context: KnowledgeSessionContext,
  query: unknown,
  options: {
    limit?: number;
    maxBodyChars?: number;
  } = {},
  db: Database = getDb(),
): Promise<PublishedKnowledgeDocument[]> {
  const normalized = normalizeQuery(query);
  const tokens = queryTokens(normalized);
  if (tokens.length === 0) return [];
  const limit = Math.min(
    Math.max(1, options.limit ?? KNOWLEDGE_SEARCH_RESULT_MAX),
    KNOWLEDGE_SEARCH_RESULT_MAX,
  );
  const tokenConditions = tokens.map((token) => {
    const pattern = `%${token}%`;
    return or(
      like(schema.knowledgeArticleVersions.titleSnapshot, pattern),
      like(schema.knowledgeArticleVersions.summarySnapshot, pattern),
      like(schema.knowledgeArticleVersions.bodySnapshot, pattern),
      like(schema.knowledgeCategories.name, pattern),
    );
  });
  const rows = await db
    .select({
      articleId: schema.knowledgeArticles.id,
      versionNumber: schema.knowledgeArticleVersions.versionNumber,
      title: schema.knowledgeArticleVersions.titleSnapshot,
      summary: schema.knowledgeArticleVersions.summarySnapshot,
      body: schema.knowledgeArticleVersions.bodySnapshot,
      categoryId: schema.knowledgeArticleVersions.categoryIdSnapshot,
      categoryName: schema.knowledgeCategories.name,
      visibility: schema.knowledgeArticleVersions.visibilitySnapshot,
      ownerUserId: schema.knowledgeArticleVersions.ownerUserIdSnapshot,
    })
    .from(schema.knowledgeArticles)
    .innerJoin(
      schema.knowledgeArticleVersions,
      and(
        eq(
          schema.knowledgeArticleVersions.articleId,
          schema.knowledgeArticles.id,
        ),
        eq(
          schema.knowledgeArticleVersions.versionNumber,
          schema.knowledgeArticles.publishedVersionNumber,
        ),
      ),
    )
    .innerJoin(
      schema.knowledgeCategories,
      eq(
        schema.knowledgeCategories.id,
        schema.knowledgeArticleVersions.categoryIdSnapshot,
      ),
    )
    .where(
      and(
        eq(schema.knowledgeArticles.status, "published"),
        isNotNull(schema.knowledgeArticles.publishedVersionNumber),
        publishedVisibilityCondition(context),
        or(...tokenConditions),
      ),
    )
    .orderBy(
      desc(schema.knowledgeArticles.updatedAt),
      asc(schema.knowledgeArticles.id),
    )
    .limit(Math.min(50, Math.max(limit * 2, limit)));

  return rows
    .map((row) => {
      const document: PublishedKnowledgeDocument = {
        articleId: row.articleId,
        versionNumber: row.versionNumber,
        citationId: `${row.articleId}:${row.versionNumber}`,
        title: row.title,
        summary: row.summary,
        body: boundedBody(
          row.body,
          normalized,
          options.maxBodyChars ?? 100_000,
        ),
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        visibility: normalizeVisibility(row.visibility),
        ownerUserId: row.ownerUserId,
      };
      return {
        document,
        score: scoreDocument(document, normalized, tokens),
      };
    })
    .filter(({ document }) =>
      canViewKnowledgeVisibility({
        role: context.role ?? "viewer",
        visibility: document.visibility,
        userId: context.user.id,
        ownerId: document.ownerUserId,
        hasRestrictedGrant: false,
      }),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.articleId.localeCompare(right.document.articleId),
    )
    .slice(0, limit)
    .map(({ document }) => document);
}

export async function searchPublishedKnowledge(
  context: KnowledgeSessionContext,
  query: unknown,
  db: Database = getDb(),
): Promise<KnowledgeSearchResult[]> {
  const normalized = normalizeQuery(query);
  const documents = await retrievePublishedKnowledge(
    context,
    normalized,
    { limit: KNOWLEDGE_SEARCH_RESULT_MAX, maxBodyChars: 20_000 },
    db,
  );
  return documents.map((document) => ({
    ...document,
    snippet: excerpt(document, normalized),
  }));
}
