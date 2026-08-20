import type { RecipientChipData } from "./recipient-utils";
import { normalizeEmail } from "./recipient-utils";

export type RecipientDirectoryEntry = {
  email: string;
  displayName: string;
  kind: "customer" | "contact" | "team" | "shared";
  customerId?: string;
  customerCode?: string;
  /** Primary CRM email when aliases may differ */
  crmPrimaryEmail?: string;
};

/** Non-CRM directory entries visible to all mail users (team, shared, public contacts). */
export const MOCK_NON_CRM_DIRECTORY: RecipientDirectoryEntry[] = [
  {
    email: "sarah.chen@external.io",
    displayName: "Sarah Chen",
    kind: "contact",
  },
  {
    email: "michael@client.hk",
    displayName: "Michael Wong",
    kind: "contact",
  },
  {
    email: "daniel@echfronthk.com",
    displayName: "Daniel",
    kind: "team",
  },
  {
    email: "a@echfronthk.com",
    displayName: "Employee A",
    kind: "team",
  },
  {
    email: "b@echfronthk.com",
    displayName: "Employee B",
    kind: "team",
  },
  {
    email: "hello@echfronthk.com",
    displayName: "ECHFRONT Hello",
    kind: "shared",
  },
  {
    email: "service@echfronthk.com",
    displayName: "ECHFRONT Service",
    kind: "shared",
  },
];

/** @deprecated Use resolveRecipientMetaForScenario — kept for tests importing legacy shape */
export function lookupRecipientMeta(
  email: string,
): Partial<RecipientChipData> | null {
  const normalized = normalizeEmail(email);
  const entry = MOCK_NON_CRM_DIRECTORY.find(
    (e) => normalizeEmail(e.email) === normalized,
  );
  if (!entry) return null;

  const crmMismatch =
    entry.customerId != null &&
    entry.crmPrimaryEmail != null &&
    normalizeEmail(entry.crmPrimaryEmail) !== normalized;

  return {
    email: normalized,
    displayName: entry.displayName,
    customerId: entry.customerId,
    customerName: entry.customerId ? entry.displayName : undefined,
    crmMismatch,
    crmRegisteredEmail: entry.crmPrimaryEmail,
    sourceKind: entry.kind,
  };
}
