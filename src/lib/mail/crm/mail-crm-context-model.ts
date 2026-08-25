import type { SafeDraftCustomerAssociationView } from "@/lib/mail/mail-customer-association-service";

export type MailCrmContextAssociation = SafeDraftCustomerAssociationView;

/** Fields permitted in read-only CRM context UI. */
export const MAIL_CRM_CONTEXT_SAFE_FIELD_KEYS = [
  "customerId",
  "customerCode",
  "name",
  "salesStage",
  "ownerName",
  "associationType",
] as const satisfies readonly (keyof MailCrmContextAssociation)[];

const FORBIDDEN_CRM_CONTEXT_FIELD_KEYS = [
  "phone",
  "email",
  "wechatId",
  "notes",
  "sourceRemark",
  "primaryConcern",
] as const;

export function hasMailCrmContextAssociation(
  association: MailCrmContextAssociation | null | undefined,
): association is MailCrmContextAssociation {
  return association != null && Boolean(association.customerId);
}

export function formatMailCrmAssociationType(
  associationType: MailCrmContextAssociation["associationType"],
  labels: {
    manual: string;
    autoMatch: string;
  },
): string {
  return associationType === "manual" ? labels.manual : labels.autoMatch;
}

export function pickMailCrmContextSafeFields(
  association: MailCrmContextAssociation,
): MailCrmContextAssociation {
  return {
    customerId: association.customerId,
    customerCode: association.customerCode,
    name: association.name,
    salesStage: association.salesStage,
    ownerName: association.ownerName,
    associationType: association.associationType,
  };
}

export function assertMailCrmContextSafeShape(
  association: Record<string, unknown>,
): void {
  for (const forbidden of FORBIDDEN_CRM_CONTEXT_FIELD_KEYS) {
    if (forbidden in association) {
      throw new Error(`Forbidden CRM context field: ${forbidden}`);
    }
  }
}

export function resolveMailCrmContextDefaultExpanded(
  variant: "desktop" | "mobile",
): boolean {
  return variant === "desktop";
}
