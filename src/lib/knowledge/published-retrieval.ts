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
import {
  expandHanSearchToken,
  expandHanSearchVariants,
  HAN_RE,
} from "@/lib/knowledge/han-search-normalization";
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

function splitLongHanToken(token: string): string[] {
  if (!HAN_RE.test(token) || token.length < 6) return [];
  const segments = new Set<string>();
  segments.add(token.slice(0, 4));
  segments.add(token.slice(-4));
  if (token.length >= 8) {
    segments.add(token.slice(4, 8));
  }
  return Array.from(segments).filter((segment) => segment.length >= 2);
}

function queryTokens(query: string): string[] {
  const baseTokens =
    query
      .toLocaleLowerCase()
      .match(/[\p{Letter}\p{Number}]+/gu)
      ?.map((token) => token.slice(0, 60)) ?? [];
  const tokens = new Set(baseTokens);
  for (const token of baseTokens) {
    for (const segment of splitLongHanToken(token)) {
      tokens.add(segment);
    }
  }
  return Array.from(tokens).slice(0, 8);
}

function sqlSearchVariants(token: string): string[] {
  return expandHanSearchToken(token).slice(0, 3);
}

function tokenVariantGroups(tokens: string[]): string[][] {
  return tokens.map((token) => expandHanSearchToken(token));
}

function fieldMatchesAnyVariant(field: string, variants: string[]): boolean {
  const lower = field.toLocaleLowerCase();
  return variants.some((variant) => lower.includes(variant));
}

function findFirstVariantIndex(haystack: string, variants: string[]): number {
  const lower = haystack.toLocaleLowerCase();
  const indexes = variants
    .map((variant) => lower.indexOf(variant))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  return indexes[0] ?? -1;
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

function scoreDocument(
  document: PublishedKnowledgeDocument,
  query: string,
  variantGroups: string[][],
) {
  const title = document.title;
  const summary = document.summary ?? "";
  const body = document.body;
  const category = document.categoryName;
  const queryVariants = expandHanSearchVariants(query);
  let score = queryVariants.some(
    (variant) => title.toLocaleLowerCase() === variant,
  )
    ? 10_000
    : 0;
  for (const variants of variantGroups) {
    if (fieldMatchesAnyVariant(title, variants)) score += 1_000;
    if (fieldMatchesAnyVariant(summary, variants)) score += 300;
    if (fieldMatchesAnyVariant(body, variants)) score += 100;
    if (fieldMatchesAnyVariant(category, variants)) score += 50;
  }
  return score;
}

function excerpt(document: PublishedKnowledgeDocument, query: string): string {
  const haystack = `${document.title}\n${document.summary ?? ""}\n${document.body}`;
  const matchIndex = findFirstVariantIndex(
    haystack,
    expandHanSearchVariants(query),
  );
  const start = matchIndex >= 0 ? Math.max(0, matchIndex - 100) : 0;
  const value = haystack.slice(start, start + 280).trim();
  return start > 0 ? `…${value}` : value;
}

function boundedBody(body: string, query: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  const variantGroups = tokenVariantGroups(queryTokens(query));
  const matchIndex = variantGroups
    .flatMap((variants) => findFirstVariantIndex(body, variants))
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
  const variantGroups = tokenVariantGroups(tokens);
  const scoringVariantGroups = variantGroups;
  const limit = Math.min(
    Math.max(1, options.limit ?? KNOWLEDGE_SEARCH_RESULT_MAX),
    KNOWLEDGE_SEARCH_RESULT_MAX,
  );
  const tokenConditions = tokens.map((token) => {
    const variants = sqlSearchVariants(token);
    const variantConditions = variants.map((variant) => {
      const pattern = `%${variant}%`;
      return or(
        like(schema.knowledgeArticleVersions.titleSnapshot, pattern),
        like(schema.knowledgeArticleVersions.summarySnapshot, pattern),
        like(schema.knowledgeArticleVersions.bodySnapshot, pattern),
        like(schema.knowledgeCategories.name, pattern),
      );
    });
    return or(...variantConditions);
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
        score: scoreDocument(document, normalized, scoringVariantGroups),
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
