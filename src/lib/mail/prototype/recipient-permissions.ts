import type { MailPrototypeScenario } from "./types";
import type { RecipientChipData } from "./recipient-utils";
import { normalizeEmail } from "./recipient-utils";
import type { RecipientDirectoryEntry } from "./recipient-directory";
import { MOCK_NON_CRM_DIRECTORY } from "./recipient-directory";

/**
 * Prototype mock CRM customers with ownership.
 * Production autocomplete/search APIs must filter on the server using the
 * existing CRM customer permission engine — never ship all customers to the browser.
 */
export type MockStaffId = "staff-a" | "staff-b";

export type MockCrmCustomer = {
  id: string;
  customerCode: string;
  name: string;
  email: string;
  ownerStaffId: MockStaffId;
};

export const MOCK_CRM_CUSTOMERS: MockCrmCustomer[] = [
  {
    id: "cust-1",
    customerCode: "EF000123",
    name: "John Smith",
    email: "john@gmail.com",
    ownerStaffId: "staff-a",
  },
  {
    id: "cust-mary",
    customerCode: "EF000124",
    name: "Mary Chen",
    email: "mary@example.com",
    ownerStaffId: "staff-a",
  },
  {
    id: "cust-2",
    customerCode: "EF000100",
    name: "Lisa Park",
    email: "lisa@startup.co",
    ownerStaffId: "staff-a",
  },
  {
    id: "cust-robert",
    customerCode: "EF000200",
    name: "Robert Lee",
    email: "robert@example.com",
    ownerStaffId: "staff-b",
  },
  {
    id: "cust-multi-1",
    customerCode: "EF000301",
    name: "Shared Client A",
    email: "info@shared-client.com",
    ownerStaffId: "staff-a",
  },
  {
    id: "cust-multi-2",
    customerCode: "EF000302",
    name: "Shared Client B",
    email: "info@shared-client.com",
    ownerStaffId: "staff-a",
  },
];

const OWNER_DISPLAY: Record<MockStaffId, string> = {
  "staff-a": "Employee A",
  "staff-b": "Employee B",
};

export function getActorStaffId(
  scenario: MailPrototypeScenario,
): MockStaffId | "admin" | null {
  switch (scenario) {
    case "admin":
      return "admin";
    case "staff_single":
    case "staff_multiple":
    case "shared_mailbox":
      return "staff-a";
    case "staff_b":
      return "staff-b";
    case "staff_no_access":
      return null;
  }
}

export function canViewCustomer(
  customer: MockCrmCustomer,
  actor: MockStaffId | "admin" | null,
): boolean {
  if (actor === "admin") return true;
  if (actor === null) return false;
  return customer.ownerStaffId === actor;
}

export function getVisibleCrmCustomers(
  scenario: MailPrototypeScenario,
): MockCrmCustomer[] {
  const actor = getActorStaffId(scenario);
  return MOCK_CRM_CUSTOMERS.filter((c) => canViewCustomer(c, actor));
}

export function getVisibleCustomerMatches(
  email: string,
  scenario: MailPrototypeScenario,
): MockCrmCustomer[] {
  const actor = getActorStaffId(scenario);
  const normalized = normalizeEmail(email);
  return MOCK_CRM_CUSTOMERS.filter(
    (c) =>
      normalizeEmail(c.email) === normalized && canViewCustomer(c, actor),
  );
}

export function getAdminGlobalCustomerMatches(email: string): Array<{
  id: string;
  name: string;
  customerCode: string;
  ownerName: string;
}> {
  const normalized = normalizeEmail(email);
  return MOCK_CRM_CUSTOMERS.filter(
    (c) => normalizeEmail(c.email) === normalized,
  ).map((c) => ({
    id: c.id,
    name: c.name,
    customerCode: c.customerCode,
    ownerName: OWNER_DISPLAY[c.ownerStaffId],
  }));
}

function hasHiddenCrmCustomerForEmail(
  email: string,
  scenario: MailPrototypeScenario,
): boolean {
  const actor = getActorStaffId(scenario);
  if (actor === "admin" || actor === null) return false;
  const normalized = normalizeEmail(email);
  const all = MOCK_CRM_CUSTOMERS.filter(
    (c) => normalizeEmail(c.email) === normalized,
  );
  const visible = all.filter((c) => canViewCustomer(c, actor));
  return all.length > 0 && visible.length === 0;
}

function crmCustomersToDirectory(
  customers: MockCrmCustomer[],
): RecipientDirectoryEntry[] {
  return customers.map((c) => ({
    email: c.email,
    displayName: c.name,
    kind: "customer" as const,
    customerId: c.id,
    customerCode: c.customerCode,
    crmPrimaryEmail: c.email,
  }));
}

/** Permission-filtered directory for autocomplete — data never includes hidden CRM rows. */
export function getVisibleRecipientDirectory(
  scenario: MailPrototypeScenario,
  query: string,
  limit = 6,
): RecipientDirectoryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const visibleCrm = crmCustomersToDirectory(getVisibleCrmCustomers(scenario));
  const canViewJohn = visibleCrm.some((e) => e.customerId === "cust-1");
  const altJohn: RecipientDirectoryEntry[] = canViewJohn
    ? [
        {
          email: "jsmith.personal@gmail.com",
          displayName: "John Smith (alt)",
          kind: "customer",
          customerId: "cust-1",
          crmPrimaryEmail: "john@gmail.com",
        },
      ]
    : [];

  const pool = [...visibleCrm, ...altJohn, ...MOCK_NON_CRM_DIRECTORY];

  return pool
    .filter((entry) => {
      const email = entry.email.toLowerCase();
      const name = entry.displayName.toLowerCase();
      const code = entry.customerCode?.toLowerCase() ?? "";
      return email.includes(q) || name.includes(q) || code.includes(q);
    })
    .slice(0, limit);
}

export function resolveRecipientMetaForScenario(
  email: string,
  scenario: MailPrototypeScenario,
): Partial<RecipientChipData> | null {
  const normalized = normalizeEmail(email);

  const visibleMatches = getVisibleCustomerMatches(normalized, scenario);
  if (visibleMatches.length > 1) {
    return {
      email: normalized,
      multipleCrmMatches: visibleMatches.map((m) => ({
        id: m.id,
        name: m.name,
        customerCode: m.customerCode,
      })),
    };
  }

  if (visibleMatches.length === 1) {
    const c = visibleMatches[0]!;
    return {
      email: normalized,
      displayName: c.name,
      customerId: c.id,
      customerName: c.name,
      customerCode: c.customerCode,
      sourceKind: "customer",
    };
  }

  const nonCrm = MOCK_NON_CRM_DIRECTORY.find(
    (e) => normalizeEmail(e.email) === normalized,
  );
  if (nonCrm) {
    const crmMismatch =
      nonCrm.customerId != null &&
      nonCrm.crmPrimaryEmail != null &&
      normalizeEmail(nonCrm.crmPrimaryEmail) !== normalized;

    if (nonCrm.customerId && !canViewCustomerById(nonCrm.customerId, scenario)) {
      return { email: normalized };
    }

    return {
      email: normalized,
      displayName: nonCrm.displayName,
      customerId: nonCrm.customerId,
      customerName: nonCrm.customerId ? nonCrm.displayName : undefined,
      crmMismatch,
      crmRegisteredEmail: nonCrm.crmPrimaryEmail,
      sourceKind: nonCrm.kind,
    };
  }

  if (hasHiddenCrmCustomerForEmail(normalized, scenario)) {
    return { email: normalized };
  }

  return null;
}

function canViewCustomerById(
  customerId: string,
  scenario: MailPrototypeScenario,
): boolean {
  const customer = MOCK_CRM_CUSTOMERS.find((c) => c.id === customerId);
  if (!customer) return false;
  return canViewCustomer(customer, getActorStaffId(scenario));
}

export function searchAssociableCustomers(
  query: string,
  scenario: MailPrototypeScenario,
  limit = 6,
): MockCrmCustomer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getVisibleCrmCustomers(scenario)
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.customerCode.toLowerCase().includes(q),
    )
    .slice(0, limit);
}

export function resolveMessageCustomerBadge(
  fromEmail: string,
  scenario: MailPrototypeScenario,
): { id: string; name: string; customerCode: string } | null {
  const matches = getVisibleCustomerMatches(fromEmail, scenario);
  if (matches.length !== 1) return null;
  const m = matches[0]!;
  return { id: m.id, name: m.name, customerCode: m.customerCode };
}

export function getCustomerOwnerName(customerId: string): string | null {
  const customer = MOCK_CRM_CUSTOMERS.find((c) => c.id === customerId);
  if (!customer) return null;
  return OWNER_DISPLAY[customer.ownerStaffId];
}
