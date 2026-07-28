import { or, isNotNull, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getCustomerAccessLevel } from "@/lib/permissions/customers";
import { isCustomerAssignee } from "@/lib/customers/assignees";
import {
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerWechat,
} from "@/lib/customers/contact-normalization";
import type { User } from "../../../drizzle/schema/users";
import type { Customer } from "../../../drizzle/schema/customers";

export type DuplicateField = "phone" | "wechatId" | "email";

export type FullDuplicateMatch = {
  field: DuplicateField;
  matchedField: DuplicateField;
  customer: {
    isMasked: false;
    id: string;
    customerCode: string | null;
    displayName: string;
    salesStage: string;
    href: string;
  };
};

export type MaskedDuplicateMatch = {
  field: DuplicateField;
  matchedField: DuplicateField;
  customer: {
    isMasked: true;
  };
};

export type DuplicateMatch = FullDuplicateMatch | MaskedDuplicateMatch;

export type CheckCustomerDuplicatesInput = {
  phoneCountryCode?: string | null;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
};

function toAuthorizedMatch(
  field: DuplicateField,
  customer: Customer,
): FullDuplicateMatch {
  return {
    field,
    matchedField: field,
    customer: {
      isMasked: false,
      id: customer.id,
      customerCode: customer.customerCode ?? null,
      displayName: customer.customerName,
      salesStage: customer.salesStage,
      href: `/customers/${customer.id}`,
    },
  };
}

function toMaskedMatch(field: DuplicateField): MaskedDuplicateMatch {
  return {
    field,
    matchedField: field,
    customer: { isMasked: true },
  };
}

async function resolveMatch(
  field: DuplicateField,
  customer: Customer,
  currentUser: User,
  db: ReturnType<typeof getDb>,
): Promise<DuplicateMatch> {
  const isAssignee =
    currentUser.role === "staff"
      ? await isCustomerAssignee(db, customer.id, currentUser.id)
      : false;
  const level = getCustomerAccessLevel(currentUser, customer, {
    isAssignee,
  });
  if (level !== "full") {
    return toMaskedMatch(field);
  }
  return toAuthorizedMatch(field, customer);
}

/**
 * Authoritative duplicate check across customers + customer_contacts.
 * Includes archived / recycle-bin / rejected on-hold rows (any remaining row).
 * Does not skip by status. Edit via excludeId skips that customer and its contacts.
 */
export async function checkCustomerDuplicates(
  input: CheckCustomerDuplicatesInput,
  currentUser: User,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const db = getDb();

  const phoneIdentity = normalizeCustomerPhone(
    input.phoneCountryCode,
    input.phone,
  );
  const wechatNorm = normalizeCustomerWechat(input.wechatId);
  const emailNorm = normalizeCustomerEmail(input.email);

  if (!phoneIdentity && !wechatNorm && !emailNorm) {
    return [];
  }

  const customerConditions = [];
  if (phoneIdentity) {
    customerConditions.push(isNotNull(schema.customers.phone));
  }
  if (wechatNorm) {
    customerConditions.push(
      sql`lower(${schema.customers.wechatId}) = ${wechatNorm}`,
    );
  }
  if (emailNorm) {
    customerConditions.push(
      sql`lower(${schema.customers.email}) = ${emailNorm}`,
    );
  }

  const customerRows =
    customerConditions.length === 0
      ? []
      : await db
          .select()
          .from(schema.customers)
          .where(or(...customerConditions));

  const contactConditions = [];
  if (phoneIdentity) {
    contactConditions.push(isNotNull(schema.customerContacts.phone));
  }
  if (wechatNorm) {
    contactConditions.push(
      sql`lower(${schema.customerContacts.wechatId}) = ${wechatNorm}`,
    );
  }
  if (emailNorm) {
    contactConditions.push(
      sql`lower(${schema.customerContacts.email}) = ${emailNorm}`,
    );
  }

  const contactRows =
    contactConditions.length === 0
      ? []
      : await db
          .select({
            contactId: schema.customerContacts.id,
            customerId: schema.customerContacts.customerId,
            phone: schema.customerContacts.phone,
            wechatId: schema.customerContacts.wechatId,
            email: schema.customerContacts.email,
          })
          .from(schema.customerContacts)
          .where(or(...contactConditions));

  const customerIdsFromContacts = [
    ...new Set(
      contactRows
        .map((r) => r.customerId)
        .filter((id) => !(excludeId && id === excludeId)),
    ),
  ];

  const contactCustomerById = new Map<string, Customer>();
  if (customerIdsFromContacts.length > 0) {
    const extra = await db
      .select()
      .from(schema.customers)
      .where(
        or(
          ...customerIdsFromContacts.map((id) =>
            eq(schema.customers.id, id),
          ),
        ),
      );
    for (const row of extra) {
      contactCustomerById.set(row.id, row);
    }
  }

  const seen = new Set<string>();
  const matches: DuplicateMatch[] = [];

  async function pushUnique(field: DuplicateField, customer: Customer) {
    if (excludeId && customer.id === excludeId) return;
    const key = `${customer.id}:${field}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push(await resolveMatch(field, customer, currentUser, db));
  }

  for (const customer of customerRows) {
    if (excludeId && customer.id === excludeId) continue;

    if (
      phoneIdentity &&
      normalizeCustomerPhone(customer.phoneCountryCode, customer.phone) ===
        phoneIdentity
    ) {
      await pushUnique("phone", customer);
    }
    if (
      wechatNorm &&
      normalizeCustomerWechat(customer.wechatId) === wechatNorm
    ) {
      await pushUnique("wechatId", customer);
    }
    if (
      emailNorm &&
      normalizeCustomerEmail(customer.email) === emailNorm
    ) {
      await pushUnique("email", customer);
    }
  }

  for (const contact of contactRows) {
    if (excludeId && contact.customerId === excludeId) continue;
    const customer =
      contactCustomerById.get(contact.customerId) ??
      customerRows.find((c) => c.id === contact.customerId);
    if (!customer) continue;

    // Secondary phones inherit the parent customer's country code (contacts have no CC column).
    if (
      phoneIdentity &&
      normalizeCustomerPhone(customer.phoneCountryCode, contact.phone) ===
        phoneIdentity
    ) {
      await pushUnique("phone", customer);
    }
    if (
      wechatNorm &&
      normalizeCustomerWechat(contact.wechatId) === wechatNorm
    ) {
      await pushUnique("wechatId", customer);
    }
    if (
      emailNorm &&
      normalizeCustomerEmail(contact.email) === emailNorm
    ) {
      await pushUnique("email", customer);
    }
  }

  return matches;
}
