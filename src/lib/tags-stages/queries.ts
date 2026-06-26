import { count, desc, ne } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { CUSTOMER_SOURCE_KEYS } from "@/lib/constants/customer-sources";
import {
  LEGACY_SALES_STAGES,
  SALES_STAGES,
} from "@/lib/constants/customer-fields";
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

  for (const key of CUSTOMER_SOURCE_KEYS) {
    seenTags.add(key);
    tags.push({
      key,
      customerCount: sourceCounts.get(key) ?? 0,
      status: "active",
    });
  }

  for (const [key, customerCount] of sourceCounts) {
    if (seenTags.has(key)) continue;
    tags.push({
      key,
      customerCount,
      status: "custom",
    });
  }

  return { stages, tags };
}
