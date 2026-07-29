/**
 * Confirmed customer-name soft duplicate check (Create only).
 * Independent from contact hard-block DuplicateField / identifiers.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getCustomerAccessLevel } from "@/lib/permissions/customers";
import { isCustomerAssignee } from "@/lib/customers/assignees";
import { normalizeCustomerNameForDuplicateMatch } from "@/lib/customers/name-duplicate";
import type { User } from "../../../drizzle/schema/users";
import type { Customer } from "../../../drizzle/schema/customers";

export type NameDuplicateAuthorizedMatch = {
  field: "name";
  matchedField: "name";
  customer: {
    isMasked: false;
    displayName: string;
    salesStage: string;
    href: string;
  };
};

export type NameDuplicateMaskedMatch = {
  field: "name";
  matchedField: "name";
  customer: {
    isMasked: true;
  };
};

export type NameDuplicateMatch =
  | NameDuplicateAuthorizedMatch
  | NameDuplicateMaskedMatch;

function toAuthorizedMatch(customer: Customer): NameDuplicateAuthorizedMatch {
  return {
    field: "name",
    matchedField: "name",
    customer: {
      isMasked: false,
      displayName: customer.customerName,
      salesStage: customer.salesStage,
      href: `/customers/${customer.id}`,
    },
  };
}

function toMaskedMatch(): NameDuplicateMaskedMatch {
  return {
    field: "name",
    matchedField: "name",
    customer: { isMasked: true },
  };
}

async function resolveMatch(
  customer: Customer,
  currentUser: User,
  db: ReturnType<typeof getDb>,
): Promise<NameDuplicateMatch> {
  const isAssignee =
    currentUser.role === "staff"
      ? await isCustomerAssignee(db, customer.id, currentUser.id)
      : false;
  const level = getCustomerAccessLevel(currentUser, customer, {
    isAssignee,
  });
  if (level !== "full") {
    return toMaskedMatch();
  }
  return toAuthorizedMatch(customer);
}

/**
 * Find confirmed customers whose name match-key equals `normalizedName`.
 * Scans all remaining customer rows (any status); pending names never match.
 * Does not skip matches for staff without view permission — those are masked.
 */
export async function checkCustomerNameDuplicates(
  normalizedName: string,
  currentUser: User,
): Promise<NameDuplicateMatch[]> {
  if (!normalizedName) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.nameStatus, "confirmed"));

  const matches: NameDuplicateMatch[] = [];
  const seenHrefOrMasked = new Set<string>();

  for (const customer of rows) {
    const key = normalizeCustomerNameForDuplicateMatch(customer.customerName);
    if (key !== normalizedName) continue;

    const match = await resolveMatch(customer, currentUser, db);
    const dedupeKey = match.customer.isMasked
      ? `masked:${customer.id}`
      : match.customer.href;
    if (seenHrefOrMasked.has(dedupeKey)) continue;
    seenHrefOrMasked.add(dedupeKey);
    matches.push(match);
  }

  return matches;
}

export function duplicateCustomerNameConflictResponse(input: {
  normalizedName: string;
  duplicates: NameDuplicateMatch[];
}): Response {
  return Response.json(
    {
      error: "发现同名客户",
      errorCode: "DUPLICATE_CUSTOMER_NAME",
      code: "duplicate_customer_name",
      duplicateName: true,
      normalizedName: input.normalizedName,
      duplicates: input.duplicates,
    },
    { status: 409 },
  );
}
