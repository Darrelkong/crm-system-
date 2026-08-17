import { asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  resolveCustomerSourceDisplayLabel,
  resolveCustomerSourceLabel,
} from "@/lib/customer-sources/resolver";
import { getSelectableCustomerSourceKeys } from "@/lib/customer-sources/keys";
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
  const rows = await db
    .select()
    .from(schema.customerTags)
    .orderBy(asc(schema.customerTags.sortOrder), asc(schema.customerTags.label));

  return rows.map(mapTagRow);
}

export async function listActiveCustomerTags(
  db: Database,
): Promise<CustomerTagListItem[]> {
  const tags = await listCustomerTags(db);
  return tags.filter((tag) => tag.isActive);
}

/** Writable/selectable keys for create, edit (when changed), and import. */
export async function getActiveCustomerTagKeys(db: Database): Promise<string[]> {
  return getSelectableCustomerSourceKeys(db);
}

export async function getCustomerTagById(
  db: Database,
  id: string,
): Promise<CustomerTagListItem | null> {
  const [row] = await db
    .select()
    .from(schema.customerTags)
    .where(eq(schema.customerTags.id, id))
    .limit(1);

  return row ? mapTagRow(row) : null;
}

export async function getCustomerTagLabelMap(
  db: Database,
): Promise<Map<string, string>> {
  const tags = await listCustomerTags(db);
  const map = new Map<string, string>();
  for (const tag of tags) {
    map.set(tag.tagKey, tag.label);
  }
  return map;
}

/** @deprecated Use resolveCustomerSourceLabel from @/lib/customer-sources/resolver */
export function resolveCustomerTagLabel(
  tagKey: string,
  labelMap: Map<string, string>,
): string {
  return resolveCustomerSourceLabel(tagKey, labelMap);
}

export function resolveCustomerTagDisplayLabel(
  tagKey: string,
  labelMap: Map<string, string>,
): string {
  return resolveCustomerSourceDisplayLabel(tagKey, labelMap);
}

export { CUSTOMER_SOURCE_OTHER_KEY };
