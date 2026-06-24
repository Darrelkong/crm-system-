import { or, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getCustomerAccessLevel } from "@/lib/permissions/customers";
import type { User } from "../../../drizzle/schema/users";

export type DuplicateField = "phone" | "wechatId" | "email";

export type DuplicateMatch = {
  field: DuplicateField;
  customer: {
    id: string;
    customerName: string;
    status: string;
    isMasked: boolean;
    phone?: string | null;
    wechatId?: string | null;
    email?: string | null;
  };
};

type CheckInput = {
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
};

export async function checkCustomerDuplicates(
  input: CheckInput,
  currentUser: User,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const db = getDb();
  const phone = input.phone?.trim() || null;
  const wechatId = input.wechatId?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;

  const conditions = [];
  if (phone) conditions.push(eq(schema.customers.phone, phone));
  if (wechatId) conditions.push(eq(schema.customers.wechatId, wechatId));
  if (email) conditions.push(eq(schema.customers.email, email));

  if (conditions.length === 0) return [];

  const rows = await db
    .select()
    .from(schema.customers)
    .where(or(...conditions));

  const matches: DuplicateMatch[] = [];

  for (const customer of rows) {
    if (customer.status === "archived") continue;
    if (excludeId && customer.id === excludeId) continue;

    let field: DuplicateField | null = null;
    if (phone && customer.phone === phone) field = "phone";
    else if (wechatId && customer.wechatId === wechatId) field = "wechatId";
    else if (email && customer.email === email) field = "email";
    if (!field) continue;

    const level = getCustomerAccessLevel(currentUser, customer);
    const isMasked = level !== "full";

    matches.push({
      field,
      customer: isMasked
        ? { id: customer.id, customerName: customer.customerName, status: customer.status, isMasked: true }
        : {
            id: customer.id,
            customerName: customer.customerName,
            status: customer.status,
            isMasked: false,
            phone: customer.phone,
            wechatId: customer.wechatId,
            email: customer.email,
          },
    });
  }

  return matches;
}
