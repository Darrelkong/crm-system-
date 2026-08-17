import { count, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  CUSTOMER_SOURCE_OTHER_KEY,
  CUSTOMER_TAG_AUDIT_ACTIONS,
  CUSTOMER_TAG_ERROR_CODES,
} from "./constants";
import {
  ensureUniqueTagKey,
  slugifyTagKey,
  validateTagLabel,
} from "./key";
import {
  getCustomerTagById,
  listCustomerTags,
  type CustomerTagListItem,
} from "./queries";

export class CustomerTagError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
  ) {
    super(message);
    this.name = "CustomerTagError";
  }
}

export function assertTagDeletable(
  tag: CustomerTagListItem,
  customerCount: number,
): void {
  if (tag.isSystem || tag.tagKey === CUSTOMER_SOURCE_OTHER_KEY) {
    throw new CustomerTagError(
      "系统标签不可删除",
      CUSTOMER_TAG_ERROR_CODES.CANNOT_DELETE_OTHER,
      400,
    );
  }

  if (customerCount > 0) {
    throw new CustomerTagError(
      `当前仍有 ${customerCount} 位历史客户使用此来源，无法删除。请改为停用。`,
      CUSTOMER_TAG_ERROR_CODES.HAS_CUSTOMERS,
      400,
    );
  }
}

export function assertTagDeactivatable(tag: CustomerTagListItem): void {
  if (tag.isSystem || tag.tagKey === CUSTOMER_SOURCE_OTHER_KEY) {
    throw new CustomerTagError(
      "系统标签不可停用",
      CUSTOMER_TAG_ERROR_CODES.CANNOT_DEACTIVATE_SYSTEM,
      400,
    );
  }
}

export async function createCustomerTag(
  db: Database,
  label: string,
): Promise<CustomerTagListItem> {
  const labelError = validateTagLabel(label);
  if (labelError) {
    throw new CustomerTagError(
      labelError === "CUSTOMER_TAG_LABEL_TOO_SHORT"
        ? "标签名称至少 2 个字符"
        : "标签名称必填",
      labelError,
    );
  }

  const existing = await listCustomerTags(db);
  const existingKeys = new Set(existing.map((tag) => tag.tagKey));
  const tagKey = ensureUniqueTagKey(slugifyTagKey(label), existingKeys);
  const now = new Date().toISOString();
  const maxSortOrder = existing.reduce(
    (max, tag) => Math.max(max, tag.sortOrder),
    0,
  );

  const row = {
    id: crypto.randomUUID(),
    tagKey,
    label: label.trim(),
    isSystem: false,
    isActive: true,
    sortOrder: maxSortOrder + 1,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schema.customerTags).values(row);
  return {
    id: row.id,
    tagKey: row.tagKey,
    label: row.label,
    isSystem: row.isSystem,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

export async function updateCustomerTagLabel(
  db: Database,
  id: string,
  label: string,
): Promise<CustomerTagListItem> {
  const labelError = validateTagLabel(label);
  if (labelError) {
    throw new CustomerTagError(
      labelError === "CUSTOMER_TAG_LABEL_TOO_SHORT"
        ? "标签名称至少 2 个字符"
        : "标签名称必填",
      labelError,
    );
  }

  const existing = await getCustomerTagById(db, id);
  if (!existing) {
    throw new CustomerTagError(
      "标签不存在",
      CUSTOMER_TAG_ERROR_CODES.NOT_FOUND,
      404,
    );
  }

  const now = new Date().toISOString();
  await db
    .update(schema.customerTags)
    .set({ label: label.trim(), updatedAt: now })
    .where(eq(schema.customerTags.id, id));

  return { ...existing, label: label.trim() };
}

export async function setCustomerTagActive(
  db: Database,
  id: string,
  isActive: boolean,
): Promise<CustomerTagListItem> {
  const tag = await getCustomerTagById(db, id);
  if (!tag) {
    throw new CustomerTagError(
      "标签不存在",
      CUSTOMER_TAG_ERROR_CODES.NOT_FOUND,
      404,
    );
  }

  if (!isActive) {
    assertTagDeactivatable(tag);
  }

  const now = new Date().toISOString();
  await db
    .update(schema.customerTags)
    .set({ isActive, updatedAt: now })
    .where(eq(schema.customerTags.id, id));

  return { ...tag, isActive };
}

async function countCustomersForTag(db: Database, tagKey: string): Promise<number> {
  const [usageRow] = await db
    .select({ value: count() })
    .from(schema.customers)
    .where(eq(schema.customers.source, tagKey));

  return usageRow?.value ?? 0;
}

export async function deleteCustomerTag(
  db: Database,
  id: string,
): Promise<{ reassignedCustomerCount: number }> {
  const tag = await getCustomerTagById(db, id);
  if (!tag) {
    throw new CustomerTagError(
      "标签不存在",
      CUSTOMER_TAG_ERROR_CODES.NOT_FOUND,
      404,
    );
  }

  const customerCount = await countCustomersForTag(db, tag.tagKey);
  assertTagDeletable(tag, customerCount);

  await db.delete(schema.customerTags).where(eq(schema.customerTags.id, id));

  return { reassignedCustomerCount: 0 };
}

export async function getCustomerCountForTag(
  db: Database,
  tagKey: string,
): Promise<number> {
  return countCustomersForTag(db, tagKey);
}

export { CUSTOMER_TAG_AUDIT_ACTIONS };
