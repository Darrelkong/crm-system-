/**
 * Customer contact identifiers (Phase 2A / D2).
 * Reuses Phase 1 contact-normalization helpers — does not reimplement rules.
 *
 * Known limitation: secondary customer_contacts.phone has no country-code column;
 * phone identity for secondary contacts uses the parent customer's phoneCountryCode
 * (same behavior as Phase 1 duplicate-check).
 */

import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerWechat,
} from "@/lib/customers/contact-normalization";
import type { ContactIdentifierType } from "../../../drizzle/schema/customer-contact-identifiers";

export type BuiltContactIdentifier = {
  contactType: ContactIdentifierType;
  normalizedValue: string;
};

export type SecondaryContactInput = {
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
};

export type BuildCustomerContactIdentifiersInput = {
  phoneCountryCode?: string | null;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  /**
   * Secondary contacts. Phone rows inherit parent phoneCountryCode
   * (contacts table has no country-code column).
   */
  secondaryContacts?: SecondaryContactInput[];
};

/**
 * Compute deduplicated identifiers for one customer from primary + secondary contacts.
 * Empty / un-normalizable values are omitted. Same value from primary and secondary
 * yields a single row.
 */
export function buildCustomerContactIdentifiers(
  input: BuildCustomerContactIdentifiersInput,
): BuiltContactIdentifier[] {
  const byKey = new Map<string, BuiltContactIdentifier>();

  function add(type: ContactIdentifierType, normalized: string | null) {
    if (!normalized) return;
    const key = `${type}|${normalized}`;
    if (!byKey.has(key)) {
      byKey.set(key, { contactType: type, normalizedValue: normalized });
    }
  }

  add(
    "phone",
    normalizeCustomerPhone(input.phoneCountryCode, input.phone),
  );
  add("wechat_id", normalizeCustomerWechat(input.wechatId));
  add("email", normalizeCustomerEmail(input.email));

  for (const contact of input.secondaryContacts ?? []) {
    // Secondary phones inherit the parent customer's country code (Phase 1 parity).
    add(
      "phone",
      normalizeCustomerPhone(input.phoneCountryCode, contact.phone),
    );
    add("wechat_id", normalizeCustomerWechat(contact.wechatId));
    add("email", normalizeCustomerEmail(contact.email));
  }

  return [...byKey.values()];
}

/**
 * Builds DELETE + INSERT statements for one customer's identifiers.
 * Callers MUST include these in the same db.batch as the customer write.
 */
export function buildReplaceCustomerIdentifierStatements(
  db: Database,
  input: {
    customerId: string;
    phoneCountryCode?: string | null;
    phone?: string | null;
    wechatId?: string | null;
    email?: string | null;
    secondaryContacts?: SecondaryContactInput[];
    now: string;
  },
) {
  const identifiers = buildCustomerContactIdentifiers({
    phoneCountryCode: input.phoneCountryCode,
    phone: input.phone,
    wechatId: input.wechatId,
    email: input.email,
    secondaryContacts: input.secondaryContacts,
  });

  const deleteStmt = db
    .delete(schema.customerContactIdentifiers)
    .where(eq(schema.customerContactIdentifiers.customerId, input.customerId));

  const insertStmts = identifiers.map((identifier) =>
    db.insert(schema.customerContactIdentifiers).values({
      id: crypto.randomUUID(),
      customerId: input.customerId,
      contactType: identifier.contactType,
      normalizedValue: identifier.normalizedValue,
      createdAt: input.now,
      updatedAt: input.now,
    }),
  );

  return {
    identifiers,
    statements: [deleteStmt, ...insertStmts],
  };
}

export async function loadSecondaryContactsForCustomer(
  db: Database,
  customerId: string,
): Promise<SecondaryContactInput[]> {
  const rows = await db
    .select({
      phone: schema.customerContacts.phone,
      wechatId: schema.customerContacts.wechatId,
      email: schema.customerContacts.email,
    })
    .from(schema.customerContacts)
    .where(eq(schema.customerContacts.customerId, customerId));
  return rows;
}

/**
 * Detects D1/SQLite unique-constraint failures on customer_contact_identifiers.
 *
 * 0041 per-customer unique:
 *   uq_customer_contact_identifiers_customer_type_value
 *   (customer_id, contact_type, normalized_value)
 *
 * Future 0042 global unique (not created yet) is expected to mention
 * contact_type + normalized_value WITHOUT customer_id, or a dedicated
 * global index name.
 *
 * Does not parse PII from error text.
 */

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}

export type IdentifierUniqueConstraintKind = "per_customer" | "global";

/**
 * Classify identifier unique failures. Returns null when not an identifiers
 * unique constraint (or not recognizable as such).
 */
export function classifyContactIdentifierUniqueConstraintError(
  error: unknown,
): IdentifierUniqueConstraintKind | null {
  const lower = errorMessage(error).toLowerCase();
  if (!lower.includes("unique constraint failed")) {
    return null;
  }

  const mentionsIdentifiersTable =
    lower.includes("customer_contact_identifiers") ||
    lower.includes("uq_customer_contact_identifiers");

  // Explicit per-customer index / composite including customer_id.
  if (
    lower.includes("uq_customer_contact_identifiers_customer_type_value") ||
    (mentionsIdentifiersTable &&
      lower.includes("customer_id") &&
      lower.includes("contact_type") &&
      lower.includes("normalized_value"))
  ) {
    return "per_customer";
  }

  // Future / explicit global index names.
  if (
    lower.includes("uq_customer_contact_identifiers_type_value") ||
    lower.includes("uq_customer_contact_identifiers_global")
  ) {
    return "global";
  }

  // Global composite: contact_type + normalized_value, no customer_id column.
  if (
    mentionsIdentifiersTable &&
    lower.includes("contact_type") &&
    lower.includes("normalized_value") &&
    !lower.includes("customer_id")
  ) {
    return "global";
  }

  return null;
}

/** @deprecated Prefer classifyContactIdentifierUniqueConstraintError. */
export function isContactIdentifierUniqueConstraintError(
  error: unknown,
): boolean {
  return classifyContactIdentifierUniqueConstraintError(error) === "global";
}

export function isGlobalContactIdentifierUniqueConstraintError(
  error: unknown,
): boolean {
  return classifyContactIdentifierUniqueConstraintError(error) === "global";
}

export function isPerCustomerIdentifierUniqueConstraintError(
  error: unknown,
): boolean {
  return (
    classifyContactIdentifierUniqueConstraintError(error) === "per_customer"
  );
}

