import type { Database } from "@/lib/db";
import {
  REQUESTED_PROJECT_GROUPS,
  REQUESTED_PROJECT_ITEMS,
  getRequestedProjectGroup,
  getRequestedProjectItem,
  type RequestedProjectLocale,
} from "@/lib/constants/requested-projects";
import {
  createBusinessCategoryMapping,
  deactivateBusinessCategoryMapping,
  getMappingByRequestedProjectCode,
  listBusinessCategoryMappings,
  updateBusinessCategoryMapping,
  type KnowledgeBusinessCategoryMappingRecord,
} from "@/lib/knowledge/knowledge-business-category-mapping-service";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export type BusinessCategoryMappingAdminStatus =
  | "unmapped"
  | "mapped"
  | "category_inactive"
  | "mapping_inactive";

export type BusinessCategoryMappingAdminRow = {
  requestedProjectCode: string;
  requestedProjectLabel: string;
  groupCode: string;
  groupLabel: string;
  mappingId: string | null;
  knowledgeCategoryId: string | null;
  knowledgeCategoryName: string | null;
  mappingActive: boolean;
  categoryActive: boolean;
  status: BusinessCategoryMappingAdminStatus;
};

function adminError(
  code: string,
  message: string,
  status = 400,
): KnowledgeServiceError {
  return new KnowledgeServiceError(code, message, status);
}

function resolveAdminStatus(input: {
  mapping: KnowledgeBusinessCategoryMappingRecord | null;
  categoryActive: boolean;
}): BusinessCategoryMappingAdminStatus {
  if (!input.mapping) {
    return "unmapped";
  }
  if (!input.mapping.isActive) {
    return "mapping_inactive";
  }
  if (!input.categoryActive) {
    return "category_inactive";
  }
  return "mapped";
}

export async function listBusinessCategoryMappingAdminRows(
  locale: RequestedProjectLocale = "zh-Hans",
  db: Database = getDb(),
): Promise<BusinessCategoryMappingAdminRow[]> {
  const mappings = await listBusinessCategoryMappings(db);
  const mappingByCode = new Map(
    mappings.map((row) => [row.requestedProjectCode, row]),
  );
  const categoryIds = [
    ...new Set(mappings.map((row) => row.knowledgeCategoryId)),
  ];
  const categoryRows =
    categoryIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.knowledgeCategories)
          .where(inArray(schema.knowledgeCategories.id, categoryIds));
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));

  const rows: BusinessCategoryMappingAdminRow[] = [];
  for (const item of REQUESTED_PROJECT_ITEMS) {
    const group = getRequestedProjectGroup(item.groupCode);
    const mapping = mappingByCode.get(item.code) ?? null;
    const category = mapping
      ? categoryById.get(mapping.knowledgeCategoryId) ?? null
      : null;
    const categoryActive = category?.isActive === true;
    rows.push({
      requestedProjectCode: item.code,
      requestedProjectLabel:
        item.labels[locale] ?? item.canonicalZhHans,
      groupCode: item.groupCode,
      groupLabel: group?.labels[locale] ?? group?.labels["zh-Hans"] ?? item.groupCode,
      mappingId: mapping?.id ?? null,
      knowledgeCategoryId: mapping?.knowledgeCategoryId ?? null,
      knowledgeCategoryName: category?.name ?? null,
      mappingActive: mapping?.isActive ?? false,
      categoryActive: mapping ? categoryActive : false,
      status: resolveAdminStatus({ mapping, categoryActive }),
    });
  }
  return rows;
}

export function listBusinessCategoryMappingAdminGroups(
  locale: RequestedProjectLocale = "zh-Hans",
): Array<{ groupCode: string; groupLabel: string; sortOrder: number }> {
  return REQUESTED_PROJECT_GROUPS.map((group) => ({
    groupCode: group.groupCode,
    groupLabel: group.labels[locale] ?? group.labels["zh-Hans"],
    sortOrder: group.order,
  }));
}

export async function createBusinessCategoryMappingAsAdmin(
  input: {
    requestedProjectCode: string;
    knowledgeCategoryId: string;
    actorUserId: string;
  },
  db: Database = getDb(),
): Promise<KnowledgeBusinessCategoryMappingRecord> {
  const code = input.requestedProjectCode.trim();
  if (!getRequestedProjectItem(code)) {
    throw adminError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "关联业务代码无效",
    );
  }

  const existing = await getMappingByRequestedProjectCode(code, db);
  if (!existing) {
    return createBusinessCategoryMapping(
      {
        requestedProjectCode: code,
        knowledgeCategoryId: input.knowledgeCategoryId,
        actorUserId: input.actorUserId,
      },
      db,
    );
  }
  if (existing.isActive) {
    throw adminError(
      KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID,
      "该关联业务已存在默认分类映射",
      409,
    );
  }
  return updateBusinessCategoryMapping(
    existing.id,
    {
      knowledgeCategoryId: input.knowledgeCategoryId,
      isActive: true,
      actorUserId: input.actorUserId,
    },
    db,
  );
}

export async function updateBusinessCategoryMappingAsAdmin(
  mappingId: string,
  input: {
    knowledgeCategoryId?: string;
    isActive?: boolean;
    actorUserId: string;
  },
  db: Database = getDb(),
): Promise<KnowledgeBusinessCategoryMappingRecord> {
  if (input.isActive === false) {
    return deactivateBusinessCategoryMapping(
      mappingId,
      input.actorUserId,
      db,
    );
  }
  return updateBusinessCategoryMapping(
    mappingId,
    {
      knowledgeCategoryId: input.knowledgeCategoryId,
      isActive: input.isActive,
      actorUserId: input.actorUserId,
    },
    db,
  );
}
