import { asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  CUSTOMER_SOURCE_KEYS,
  INTERNAL_CUSTOMER_SOURCE_KEYS,
} from "@/lib/constants/customer-sources";
import {
  CUSTOMER_SOURCE_LABELS,
  INTERNAL_CUSTOMER_SOURCE_LABELS,
} from "@/lib/constants/customer-source-labels";
import { CUSTOMER_SOURCE_OTHER_KEY } from "./constants";
import type { CustomerTag } from "../../../drizzle/schema/customer-tags";

export type CustomerTagListItem = {
  id: string;
  tagKey: string;
  label: string;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
};

function fallbackTagsFromConstants(): CustomerTagListItem[] {
  return CUSTOMER_SOURCE_KEYS.map((key, index) => ({
    id: `fallback-${key}`,
    tagKey: key,
    label: CUSTOMER_SOURCE_LABELS[key],
    isSystem: key === CUSTOMER_SOURCE_OTHER_KEY,
    isActive: true,
    sortOrder: index + 1,
  }));
}

function mapTagRow(row: CustomerTag): CustomerTagListItem {
  return {
    id: row.id,
    tagKey: row.tagKey,
    label: row.label,
    isSystem: row.isSystem,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

export async function listCustomerTags(db: Database): Promise<CustomerTagListItem[]> {
  try {
    const rows = await db
      .select()
      .from(schema.customerTags)
      .orderBy(asc(schema.customerTags.sortOrder), asc(schema.customerTags.label));

    if (rows.length === 0) {
      return fallbackTagsFromConstants();
    }

    return rows.map(mapTagRow);
  } catch {
    return fallbackTagsFromConstants();
  }
}

export async function listActiveCustomerTags(
  db: Database,
): Promise<CustomerTagListItem[]> {
  const tags = await listCustomerTags(db);
  return tags.filter((tag) => tag.isActive);
}

export async function getActiveCustomerTagKeys(db: Database): Promise<string[]> {
  const tags = await listActiveCustomerTags(db);
  return tags.map((tag) => tag.tagKey);
}

export async function getCustomerTagById(
  db: Database,
  id: string,
): Promise<CustomerTagListItem | null> {
  try {
    const [row] = await db
      .select()
      .from(schema.customerTags)
      .where(eq(schema.customerTags.id, id))
      .limit(1);

    return row ? mapTagRow(row) : null;
  } catch {
    return null;
  }
}

export async function getCustomerTagLabelMap(
  db: Database,
): Promise<Map<string, string>> {
  const tags = await listCustomerTags(db);
  const map = new Map<string, string>();
  for (const tag of tags) {
    map.set(tag.tagKey, tag.label);
  }
  for (const key of CUSTOMER_SOURCE_KEYS) {
    if (!map.has(key)) {
      map.set(key, CUSTOMER_SOURCE_LABELS[key]);
    }
  }
  for (const key of INTERNAL_CUSTOMER_SOURCE_KEYS) {
    if (!map.has(key)) {
      map.set(key, INTERNAL_CUSTOMER_SOURCE_LABELS[key]);
    }
  }
  return map;
}

export function resolveCustomerTagLabel(
  tagKey: string,
  labelMap: Map<string, string>,
): string {
  return (
    labelMap.get(tagKey) ??
    INTERNAL_CUSTOMER_SOURCE_LABELS[
      tagKey as keyof typeof INTERNAL_CUSTOMER_SOURCE_LABELS
    ] ??
    CUSTOMER_SOURCE_LABELS[tagKey as keyof typeof CUSTOMER_SOURCE_LABELS] ??
    tagKey
  );
}
