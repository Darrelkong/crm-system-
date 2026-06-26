import { count, desc, ne } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { CUSTOMER_SOURCE_LABELS } from "@/lib/constants/customer-source-labels";
import {
  LEGACY_SALES_STAGES,
  SALES_STAGES,
} from "@/lib/constants/customer-fields";
import { listCustomerTags } from "@/lib/customer-tags/queries";
import type {
  StageCatalogItem,
  TagCatalogItem,
  TagsStagesOverview,
} from "./types";

async function countCustomersByField(
  db: Database,
  field: typeof schema.customers.salesStage | typeof schema.customers.source,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      label: field,
      count: count(),
    })
    .from(schema.customers)
    .where(ne(schema.customers.status, "archived"))
    .groupBy(field)
    .orderBy(desc(count()));

  return new Map(rows.map((row) => [row.label, row.count]));
}

export async function getTagsStagesOverview(
  db: Database,
): Promise<TagsStagesOverview> {
  const stageCounts = await countCustomersByField(db, schema.customers.salesStage);
  const sourceCounts = await countCustomersByField(db, schema.customers.source);
  const dbTags = await listCustomerTags(db);

  const stages: StageCatalogItem[] = [];
  const seenStages = new Set<string>();

  SALES_STAGES.forEach((key, index) => {
    seenStages.add(key);
    stages.push({
      key,
      customerCount: stageCounts.get(key) ?? 0,
      sortOrder: index + 1,
      status: "active",
    });
  });

  for (const key of LEGACY_SALES_STAGES) {
    if (seenStages.has(key)) continue;
    seenStages.add(key);
    stages.push({
      key,
      customerCount: stageCounts.get(key) ?? 0,
      sortOrder: null,
      status: "legacy",
    });
  }

  for (const [key, customerCount] of stageCounts) {
    if (seenStages.has(key)) continue;
    stages.push({
      key,
      customerCount,
      sortOrder: null,
      status: "custom",
    });
  }

  const tags: TagCatalogItem[] = [];
  const seenTags = new Set<string>();

  for (const tag of dbTags) {
    seenTags.add(tag.tagKey);
    tags.push({
      id: tag.id,
      key: tag.tagKey,
      label: tag.label,
      customerCount: sourceCounts.get(tag.tagKey) ?? 0,
      status: tag.isActive ? "active" : "inactive",
      isSystem: tag.isSystem,
    });
  }

  for (const [key, customerCount] of sourceCounts) {
    if (seenTags.has(key)) continue;
    tags.push({
      key,
      label:
        CUSTOMER_SOURCE_LABELS[key as keyof typeof CUSTOMER_SOURCE_LABELS] ??
        key,
      customerCount,
      status: "custom",
      isSystem: false,
    });
  }

  return { stages, tags };
}
