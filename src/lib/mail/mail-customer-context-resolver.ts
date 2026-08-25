import { eq } from "drizzle-orm";
import type { MailMessage } from "../../../drizzle/schema/mail-messages";
import type { Database } from "@/lib/db";
import { schema as dbSchema } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  buildSafeCustomerAssociationView,
  isMailCustomerAssociationType,
  type SafeDraftCustomerAssociationView,
} from "@/lib/mail/mail-customer-association-service";
import { lookupMailCustomerByEmail } from "@/lib/mail/mail-customer-lookup-service";
import { getUserById } from "@/lib/users/queries";

/**
 * Future CRM context boundary for the mail read layer.
 *
 * Message read services MUST NOT call customer lookup directly.
 * Production detail resolution composes:
 *
 *   getMessageDetail() → resolveMessageCustomerAssociation()
 */
export type MailCustomerContextResolver = {
  resolveForMessage(
    db: Database,
    actor: MailActorContext,
    message: Pick<MailMessage, "id" | "direction" | "fromAddress" | "mailboxId">,
  ): Promise<SafeDraftCustomerAssociationView | null>;
};

export type MailCustomerContextResolverFactory = () => MailCustomerContextResolver;

async function loadActorUser(
  actor: MailActorContext,
): Promise<Awaited<ReturnType<typeof getUserById>>> {
  return getUserById(actor.userId);
}

async function resolveOutboundMessageCustomerAssociation(
  db: Database,
  actor: MailActorContext,
  messageId: string,
): Promise<SafeDraftCustomerAssociationView | null> {
  const materializations = await db
    .select({
      revisionId: dbSchema.mailOutboundMessageMaterializations.outboundRevisionId,
    })
    .from(dbSchema.mailOutboundMessageMaterializations)
    .where(eq(dbSchema.mailOutboundMessageMaterializations.mailMessageId, messageId));

  if (materializations.length !== 1) {
    return null;
  }

  const [revision] = await db
    .select({
      customerId: dbSchema.mailOutboundRevisions.customerId,
      customerAssociationType:
        dbSchema.mailOutboundRevisions.customerAssociationType,
    })
    .from(dbSchema.mailOutboundRevisions)
    .where(eq(dbSchema.mailOutboundRevisions.id, materializations[0]!.revisionId))
    .limit(1);

  if (!revision?.customerId || !revision.customerAssociationType) {
    return null;
  }

  if (!isMailCustomerAssociationType(revision.customerAssociationType)) {
    return null;
  }

  const user = await loadActorUser(actor);
  if (!user) {
    return null;
  }

  return buildSafeCustomerAssociationView(
    db,
    user,
    revision.customerId,
    revision.customerAssociationType,
  );
}

async function resolveInboundMessageCustomerAssociation(
  db: Database,
  actor: MailActorContext,
  fromAddress: string,
): Promise<SafeDraftCustomerAssociationView | null> {
  const user = await loadActorUser(actor);
  if (!user) {
    return null;
  }

  const lookup = await lookupMailCustomerByEmail(db, user, fromAddress);
  if (!lookup.matched || !lookup.customer) {
    return null;
  }

  return {
    customerId: lookup.customer.id,
    customerCode: lookup.customer.customerCode,
    name: lookup.customer.name,
    salesStage: lookup.customer.salesStage,
    ownerName: lookup.customer.ownerName,
    associationType: "auto_match",
  };
}

/**
 * Resolves production-safe CRM customer context for one authorized message.
 * Returns null when no association exists or CRM access is denied.
 */
export async function resolveMessageCustomerAssociation(
  db: Database,
  actor: MailActorContext,
  message: Pick<MailMessage, "id" | "direction" | "fromAddress" | "mailboxId">,
): Promise<SafeDraftCustomerAssociationView | null> {
  if (message.direction === "outbound") {
    return resolveOutboundMessageCustomerAssociation(db, actor, message.id);
  }

  return resolveInboundMessageCustomerAssociation(db, actor, message.fromAddress);
}

export const defaultMailCustomerContextResolver: MailCustomerContextResolver = {
  resolveForMessage(db, actor, message) {
    return resolveMessageCustomerAssociation(db, actor, message);
  },
};

/** @deprecated Use defaultMailCustomerContextResolver. */
export const UNIMPLEMENTED_MAIL_CUSTOMER_CONTEXT_RESOLVER: MailCustomerContextResolver =
  defaultMailCustomerContextResolver;
