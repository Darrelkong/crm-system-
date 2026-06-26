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

export function assertTagDeletable(tag: CustomerTagListItem): void {
  if (tag.isSystem || tag.tagKey === CUSTOMER_SOURCE_OTHER_KEY) {
    throw new CustomerTagError(
      "系统标签不可删除",
      CUSTOMER_TAG_ERROR_CODES.CANNOT_DELETE_OTHER,
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

  assertTagDeletable(tag);

  const [usageRow] = await db
    .select({ value: count() })
    .from(schema.customers)
    .where(eq(schema.customers.source, tag.tagKey));

  const reassignedCustomerCount = usageRow?.value ?? 0;
  const now = new Date().toISOString();

  if (reassignedCustomerCount > 0) {
    await db
      .update(schema.customers)
      .set({ source: CUSTOMER_SOURCE_OTHER_KEY, updatedAt: now })
      .where(eq(schema.customers.source, tag.tagKey));
  }

  await db.delete(schema.customerTags).where(eq(schema.customerTags.id, id));

  return { reassignedCustomerCount };
}

export { CUSTOMER_TAG_AUDIT_ACTIONS };
