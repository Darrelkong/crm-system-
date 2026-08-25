import { eq } from "drizzle-orm";
import type { MailDraft } from "../../../drizzle/schema/mail-drafts";
import {
  MAIL_CUSTOMER_ASSOCIATION_TYPES,
  type MailCustomerAssociationType,
} from "../../../drizzle/schema/mail-drafts";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { MailServiceError } from "@/lib/mail/errors";
import {
  getCustomerAccessLevel,
  resolveCustomerAccessOptions,
} from "@/lib/permissions/customers";
import { getUserById } from "@/lib/users/queries";

export type SafeDraftCustomerAssociationView = {
  customerId: string;
  customerCode: string | null;
  name: string;
  salesStage: string;
  ownerName: string | null;
  associationType: MailCustomerAssociationType;
};

export function isMailCustomerAssociationType(
  value: string,
): value is MailCustomerAssociationType {
  return (MAIL_CUSTOMER_ASSOCIATION_TYPES as readonly string[]).includes(value);
}

function canAssociateCustomer(
  user: User,
  customer: Customer,
  accessOptions: Awaited<ReturnType<typeof resolveCustomerAccessOptions>>,
): boolean {
  const accessLevel = getCustomerAccessLevel(user, customer, accessOptions);
  return accessLevel === "full" || accessLevel === "archived_basic";
}

export async function assertCanAssociateMailCustomer(
  db: Database,
  user: User,
  customerId: string,
): Promise<Customer> {
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);

  if (!customer) {
    throw MailServiceError.notFound("Customer not found");
  }

  const accessOptions = await resolveCustomerAccessOptions(db, user, customer.id);
  if (!canAssociateCustomer(user, customer, accessOptions)) {
    throw MailServiceError.forbidden("Customer association not permitted");
  }

  return customer;
}

export async function buildSafeCustomerAssociationView(
  db: Database,
  user: User,
  customerId: string,
  associationType: MailCustomerAssociationType,
): Promise<SafeDraftCustomerAssociationView | null> {
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);

  if (!customer) {
    return null;
  }

  const accessOptions = await resolveCustomerAccessOptions(db, user, customer.id);
  if (!canAssociateCustomer(user, customer, accessOptions)) {
    return null;
  }

  let ownerName: string | null = null;
  if (customer.ownerId) {
    const owner = await getUserById(customer.ownerId);
    ownerName = owner?.displayName ?? null;
  }

  return {
    customerId,
    customerCode: customer.customerCode ?? null,
    name: customer.customerName,
    salesStage: customer.salesStage,
    ownerName,
    associationType,
  };
}

export async function buildDraftCustomerAssociationView(
  db: Database,
  user: User,
  draft: MailDraft,
): Promise<SafeDraftCustomerAssociationView | null> {
  if (!draft.customerId || !draft.customerAssociationType) {
    return null;
  }

  return buildSafeCustomerAssociationView(
    db,
    user,
    draft.customerId,
    draft.customerAssociationType,
  );
}

export type DraftCustomerAssociationPatch =
  | { clear: true }
  | {
      customerId: string;
      associationType: MailCustomerAssociationType;
    };

export function parseDraftCustomerAssociationPatch(
  body: Record<string, unknown>,
): DraftCustomerAssociationPatch | undefined {
  if (!("customerId" in body)) {
    return undefined;
  }

  const customerId = body.customerId;
  if (customerId === null) {
    return { clear: true };
  }

  if (typeof customerId !== "string" || !customerId.trim()) {
    throw MailServiceError.validation(
      "customerId must be a non-empty string or null",
    );
  }

  const associationType = body.customerAssociationType;
  if (
    typeof associationType !== "string" ||
    !isMailCustomerAssociationType(associationType)
  ) {
    throw MailServiceError.validation(
      "customerAssociationType must be manual or auto_match",
    );
  }

  return {
    customerId: customerId.trim(),
    associationType,
  };
}

export function draftCustomerAssociationFieldsForPatch(
  patch: DraftCustomerAssociationPatch,
  actorUserId: string,
  now: string,
): Pick<
  MailDraft,
  | "customerId"
  | "customerAssociationType"
  | "customerAssociatedByUserId"
  | "customerAssociatedAt"
> {
  if ("clear" in patch) {
    return {
      customerId: null,
      customerAssociationType: null,
      customerAssociatedByUserId: null,
      customerAssociatedAt: null,
    };
  }

  return {
    customerId: patch.customerId,
    customerAssociationType: patch.associationType,
    customerAssociatedByUserId:
      patch.associationType === "manual" ? actorUserId : null,
    customerAssociatedAt: now,
  };
}
