import { and, eq } from "drizzle-orm";
import { normalizeCustomerEmail } from "@/lib/customers/contact-normalization";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  getCustomerAccessLevel,
  resolveCustomerAccessOptions,
  type CustomerAccessLevel,
} from "@/lib/permissions/customers";
import { getUserById } from "@/lib/users/queries";
import type { User } from "../../../drizzle/schema/users";

export type MailCustomerLookupMatchType =
  | "exact_email"
  | "no_match"
  | "denied"
  | "ambiguous";

export type MailCustomerContextCustomerSummary = {
  id: string;
  customerCode: string | null;
  name: string;
  salesStage: string;
  ownerName: string | null;
};

export type MailCustomerContextResult = {
  matched: boolean;
  matchType: MailCustomerLookupMatchType;
  accessLevel: CustomerAccessLevel | null;
  customer: MailCustomerContextCustomerSummary | null;
};

const NO_MATCH: MailCustomerContextResult = {
  matched: false,
  matchType: "no_match",
  accessLevel: null,
  customer: null,
};

function deniedResult(accessLevel: CustomerAccessLevel): MailCustomerContextResult {
  return {
    matched: false,
    matchType: "denied",
    accessLevel,
    customer: null,
  };
}

function canReturnCustomerSummary(accessLevel: CustomerAccessLevel): boolean {
  return accessLevel === "full" || accessLevel === "archived_basic";
}

export async function lookupMailCustomerByEmail(
  db: Database,
  user: User,
  email: string,
): Promise<MailCustomerContextResult> {
  const normalizedEmail = normalizeCustomerEmail(email);
  if (!normalizedEmail) {
    return NO_MATCH;
  }

  const identifierRows = await db
    .select({
      customerId: schema.customerContactIdentifiers.customerId,
    })
    .from(schema.customerContactIdentifiers)
    .where(
      and(
        eq(schema.customerContactIdentifiers.contactType, "email"),
        eq(schema.customerContactIdentifiers.normalizedValue, normalizedEmail),
      ),
    );

  if (identifierRows.length === 0) {
    return NO_MATCH;
  }

  if (identifierRows.length > 1) {
    const uniqueCustomerIds = new Set(
      identifierRows.map((row) => row.customerId),
    );
    if (uniqueCustomerIds.size > 1) {
      return {
        matched: false,
        matchType: "ambiguous",
        accessLevel: null,
        customer: null,
      };
    }
  }

  const customerId = identifierRows[0]!.customerId;

  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);

  if (!customer) {
    return NO_MATCH;
  }

  const accessOptions = await resolveCustomerAccessOptions(db, user, customer.id);
  const accessLevel = getCustomerAccessLevel(user, customer, accessOptions);

  if (!canReturnCustomerSummary(accessLevel)) {
    return deniedResult(accessLevel);
  }

  let ownerName: string | null = null;
  if (customer.ownerId) {
    const owner = await getUserById(customer.ownerId);
    ownerName = owner?.displayName ?? null;
  }

  return {
    matched: true,
    matchType: "exact_email",
    accessLevel,
    customer: {
      id: customer.id,
      customerCode: customer.customerCode ?? null,
      name: customer.customerName,
      salesStage: customer.salesStage,
      ownerName,
    },
  };
}
