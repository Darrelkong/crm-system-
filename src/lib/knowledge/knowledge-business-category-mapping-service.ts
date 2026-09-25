import { asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { getRequestedProjectItem } from "@/lib/constants/requested-projects";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";

export type KnowledgeCategoryResolutionStatus =
  | "matched"
  | "unmapped"
  | "invalid_business"
  | "inactive_category"
  | "inactive_mapping";

export type KnowledgeCategoryResolutionSource = "explicit_mapping" | null;

export type KnowledgeCategoryResolution = {
  status: KnowledgeCategoryResolutionStatus;
  requestedProjectCode: string;
  categoryId?: string;
  categoryName?: string;
  resolutionSource: KnowledgeCategoryResolutionSource;
};

export type KnowledgeBusinessCategoryMappingRecord = {
  id: string;
  requestedProjectCode: string;
  knowledgeCategoryId: string;
  isActive: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

function mappingError(
  code: string,
  message: string,
  status = 400,
): KnowledgeServiceError {
  return new KnowledgeServiceError(code, message, status);
}

function assertValidRequestedProjectCode(code: string): void {
  if (!getRequestedProjectItem(code)) {
    throw mappingError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "关联业务代码无效",
    );
  }
}

async function getCategoryRow(
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

async function assertActiveKnowledgeCategory(
  categoryId: string,
  db: Database,
): Promise<typeof schema.knowledgeCategories.$inferSelect> {
  const category = await getCategoryRow(categoryId, db);
  if (!category) {
    throw mappingError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_NOT_FOUND,
      "知识库分类不存在",
      404,
    );
  }
  if (!category.isActive) {
    throw mappingError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "不能映射到已停用的知识库分类",
    );
  }
  return category;
}

function mapRow(
  row: typeof schema.knowledgeBusinessCategoryMappings.$inferSelect,
): KnowledgeBusinessCategoryMappingRecord {
  return {
    id: row.id,
    requestedProjectCode: row.requestedProjectCode,
    knowledgeCategoryId: row.knowledgeCategoryId,
    isActive: row.isActive,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getMappingByRequestedProjectCode(
  requestedProjectCode: string,
  db: Database = getDb(),
): Promise<KnowledgeBusinessCategoryMappingRecord | null> {
  const rows = await db
    .select()
    .from(schema.knowledgeBusinessCategoryMappings)
    .where(
      eq(
        schema.knowledgeBusinessCategoryMappings.requestedProjectCode,
        requestedProjectCode,
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function listBusinessCategoryMappings(
  db: Database = getDb(),
): Promise<KnowledgeBusinessCategoryMappingRecord[]> {
  const rows = await db
    .select()
    .from(schema.knowledgeBusinessCategoryMappings)
    .orderBy(
      asc(schema.knowledgeBusinessCategoryMappings.requestedProjectCode),
    );
  return rows.map(mapRow);
}

export async function createBusinessCategoryMapping(
  input: {
    requestedProjectCode: string;
    knowledgeCategoryId: string;
    actorUserId?: string | null;
  },
  db: Database = getDb(),
): Promise<KnowledgeBusinessCategoryMappingRecord> {
  const code = input.requestedProjectCode.trim();
  assertValidRequestedProjectCode(code);
  await assertActiveKnowledgeCategory(input.knowledgeCategoryId, db);

  const existing = await getMappingByRequestedProjectCode(code, db);
  if (existing) {
    throw mappingError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "该关联业务已存在默认分类映射",
      409,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.insert(schema.knowledgeBusinessCategoryMappings).values({
      id,
      requestedProjectCode: code,
      knowledgeCategoryId: input.knowledgeCategoryId,
      isActive: true,
      createdByUserId: input.actorUserId ?? null,
      updatedByUserId: input.actorUserId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed|uq_knowledge_business_category_mappings_code/i.test(
        error.message,
      )
    ) {
      throw mappingError(
        KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
        "该关联业务已存在默认分类映射",
        409,
      );
    }
    throw error;
  }
  const created = await getMappingByRequestedProjectCode(code, db);
  if (!created) {
    throw mappingError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "分类映射建立失败",
      500,
    );
  }
  return created;
}

export async function updateBusinessCategoryMapping(
  mappingId: string,
  input: {
    knowledgeCategoryId?: string;
    isActive?: boolean;
    actorUserId?: string | null;
  },
  db: Database = getDb(),
): Promise<KnowledgeBusinessCategoryMappingRecord> {
  const rows = await db
    .select()
    .from(schema.knowledgeBusinessCategoryMappings)
    .where(eq(schema.knowledgeBusinessCategoryMappings.id, mappingId))
    .limit(1);
  const current = rows[0];
  if (!current) {
    throw mappingError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_NOT_FOUND,
      "分类映射不存在",
      404,
    );
  }
  const nextCategoryId = input.knowledgeCategoryId ?? current.knowledgeCategoryId;
  if (input.knowledgeCategoryId) {
    await assertActiveKnowledgeCategory(nextCategoryId, db);
  } else if (input.isActive === true && !current.isActive) {
    await assertActiveKnowledgeCategory(nextCategoryId, db);
  }

  const updatedAt = new Date().toISOString();
  await db
    .update(schema.knowledgeBusinessCategoryMappings)
    .set({
      knowledgeCategoryId: nextCategoryId,
      isActive: input.isActive ?? current.isActive,
      updatedByUserId: input.actorUserId ?? current.updatedByUserId,
      updatedAt,
    })
    .where(eq(schema.knowledgeBusinessCategoryMappings.id, mappingId));

  const updated = await db
    .select()
    .from(schema.knowledgeBusinessCategoryMappings)
    .where(eq(schema.knowledgeBusinessCategoryMappings.id, mappingId))
    .limit(1);
  if (!updated[0]) {
    throw mappingError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "分类映射更新失败",
      500,
    );
  }
  return mapRow(updated[0]);
}

export async function deactivateBusinessCategoryMapping(
  mappingId: string,
  actorUserId?: string | null,
  db: Database = getDb(),
): Promise<KnowledgeBusinessCategoryMappingRecord> {
  return updateBusinessCategoryMapping(
    mappingId,
    { isActive: false, actorUserId },
    db,
  );
}

/**
 * Priority 1 deterministic resolver — business code only (segment-safe).
 */
export async function resolveKnowledgeCategoryForBusiness(
  requestedProjectCode: string,
  db: Database = getDb(),
): Promise<KnowledgeCategoryResolution> {
  const code = requestedProjectCode.trim();
  if (!code) {
    return {
      status: "invalid_business",
      requestedProjectCode: code,
      resolutionSource: null,
    };
  }
  if (!getRequestedProjectItem(code)) {
    return {
      status: "invalid_business",
      requestedProjectCode: code,
      resolutionSource: null,
    };
  }

  const mapping = await getMappingByRequestedProjectCode(code, db);
  if (!mapping) {
    return {
      status: "unmapped",
      requestedProjectCode: code,
      resolutionSource: null,
    };
  }
  if (!mapping.isActive) {
    return {
      status: "inactive_mapping",
      requestedProjectCode: code,
      resolutionSource: null,
    };
  }

  const category = await getCategoryRow(mapping.knowledgeCategoryId, db);
  if (!category || !category.isActive) {
    return {
      status: "inactive_category",
      requestedProjectCode: code,
      resolutionSource: null,
    };
  }

  return {
    status: "matched",
    requestedProjectCode: code,
    categoryId: category.id,
    categoryName: category.name,
    resolutionSource: "explicit_mapping",
  };
}
