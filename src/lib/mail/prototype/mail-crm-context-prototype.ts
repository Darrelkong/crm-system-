import type { SafeDraftCustomerAssociationView } from "@/lib/mail/mail-customer-association-service";
import type { MailMessage, MailPrototypeScenario } from "./types";
import {
  canViewCustomer,
  getActorStaffId,
  getCustomerOwnerName,
  MOCK_CRM_CUSTOMERS,
} from "./recipient-permissions";

const MOCK_CUSTOMER_SALES_STAGES: Record<string, string> = {
  "cust-1": "interested",
  "cust-mary": "contacted",
  "cust-2": "proposal",
  "cust-robert": "negotiation",
};

/**
 * Prototype-only resolver until message detail is backed by persisted mail APIs.
 * Uses mock CRM catalog with the same permission filtering as recipient autocomplete.
 */
export function resolveMailMessageCustomerAssociation(
  message: MailMessage,
  scenario: MailPrototypeScenario,
): SafeDraftCustomerAssociationView | null {
  if (message.customerAssociation) {
    return message.customerAssociation;
  }

  const linked =
    message.manualCustomerAssociation ?? message.customerMatch ?? null;
  if (!linked) {
    return null;
  }

  const customer = MOCK_CRM_CUSTOMERS.find((entry) => entry.id === linked.id);
  if (!customer) {
    return null;
  }

  const actor = getActorStaffId(scenario);
  if (actor !== "admin" && actor !== null && !canViewCustomer(customer, actor)) {
    return null;
  }

  return {
    customerId: customer.id,
    customerCode: customer.customerCode,
    name: customer.name,
    salesStage: MOCK_CUSTOMER_SALES_STAGES[customer.id] ?? "new_lead",
    ownerName: getCustomerOwnerName(customer.id),
    associationType: message.manualCustomerAssociation ? "manual" : "auto_match",
  };
}
