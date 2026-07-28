/**
 * Phase 2A backfill for customer_contact_identifiers.
 * Default dry-run; apply only when cross-customer conflicts are zero.
 * Does not mutate customers / customer_contacts source contact fields.
 */

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  buildCustomerContactIdentifiers,
  buildReplaceCustomerIdentifierStatements,
  type BuiltContactIdentifier,
  type SecondaryContactInput,
} from "@/lib/customers/contact-identifiers";
import {
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerWechat,
} from "@/lib/customers/contact-normalization";
import type { ContactIdentifierType } from "../../../drizzle/schema/customer-contact-identifiers";

export type MaskedIdentifierConflict = {
  contactType: ContactIdentifierType;
  valueHash: string;
  maskedValue: string;
  customerIds: string[];
  customerCodes: Array<string | null>;
};

export type CustomerIdentifierPlan = {
  customerId: string;
  customerCode: string | null;
  status: string;
  identifiers: BuiltContactIdentifier[];
  unnormalizableCount: number;
};

export type ContactIdentifiersBackfillDryRunResult = {
  mode: "dry-run";
  customersScanned: number;
  identifierCount: number;
  /** Rows currently in customer_contact_identifiers. */
  existingIdentifierCount: number;
  wouldInsert: number;
  wouldDelete: number;
  wouldKeep: number;
  conflictCount: number;
  conflicts: MaskedIdentifierConflict[];
  unnormalizableCount: number;
  safeToApply: boolean;
  rowsWritten: 0;
};

export type ContactIdentifiersBackfillApplyResult = {
  mode: "apply";
  customersScanned: number;
  identifierCount: number;
  existingIdentifierCountBefore: number;
  inserted: number;
  deleted: number;
  kept: number;
  conflictCount: 0;
  unnormalizableCount: number;
  customersSynced: number;
  rowsWritten: number;
  coverage: ContactIdentifierCoverageResult;
};

export type MaskedCoverageAnomaly = {
  kind:
    | "missing"
    | "extra"
    | "ownership_mismatch"
    | "intra_customer_duplicate"
    | "cross_customer_conflict";
  contactType: ContactIdentifierType;
  maskedValue: string;
  valueHash: string;
  customerCode: string | null;
  status: string | null;
};

export type ContactIdentifierCoverageResult = {
  customersTotal: number;
  expectedIdentifierCount: number;
  actualIdentifierCount: number;
  missingCount: number;
  extraCount: number;
  ownershipMismatchCount: number;
  intraCustomerDuplicateCount: number;
  crossCustomerConflictCount: number;
  unnormalizableCount: number;
  anomalies: MaskedCoverageAnomaly[];
  ok: boolean;
};

export class ContactIdentifiersBackfillError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ContactIdentifiersBackfillError";
    this.code = code;
  }
}

function sha12(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

/** Mask normalized phone/email/wechat — never return full PII. */
export function maskNormalizedIdentifier(
  contactType: ContactIdentifierType,
  normalizedValue: string,
): string {
  if (contactType === "phone") {
    const digits = normalizedValue.replace(/\D/g, "");
    if (digits.length <= 4) return `****${digits}`;
    const last4 = digits.slice(-4);
    const prefix = normalizedValue.startsWith("+")
      ? normalizedValue.slice(0, Math.min(3, normalizedValue.length))
      : "+";
    return `${prefix} ****${last4}`;
  }
  if (contactType === "email") {
    const at = normalizedValue.indexOf("@");
    if (at <= 0) return "***@***";
    const local = normalizedValue.slice(0, at);
    const domain = normalizedValue.slice(at + 1);
    const localMask =
      local.length <= 1 ? "*" : `${local[0]}***${local[local.length - 1] ?? ""}`;
    const domainMask =
      domain.length <= 2 ? "***" : `${domain[0]}***${domain.slice(-2)}`;
    return `${localMask}@${domainMask}`;
  }
  // wechat_id
  if (normalizedValue.length <= 2) return "***";
  return `${normalizedValue[0]}***${normalizedValue[normalizedValue.length - 1]}`;
}

function countUnnormalizable(input: {
  phoneCountryCode?: string | null;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  secondaryContacts?: SecondaryContactInput[];
}): number {
  let count = 0;
  const phoneRaw = input.phone?.trim();
  if (phoneRaw && !normalizeCustomerPhone(input.phoneCountryCode, input.phone)) {
    count += 1;
  }
  const wechatRaw = input.wechatId?.trim();
  if (wechatRaw && !normalizeCustomerWechat(input.wechatId)) {
    count += 1;
  }
  const emailRaw = input.email?.trim();
  if (emailRaw && !normalizeCustomerEmail(input.email)) {
    count += 1;
  }
  for (const contact of input.secondaryContacts ?? []) {
    const sPhone = contact.phone?.trim();
    if (
      sPhone &&
      !normalizeCustomerPhone(input.phoneCountryCode, contact.phone)
    ) {
      count += 1;
    }
    const sWechat = contact.wechatId?.trim();
    if (sWechat && !normalizeCustomerWechat(contact.wechatId)) {
      count += 1;
    }
    const sEmail = contact.email?.trim();
    if (sEmail && !normalizeCustomerEmail(contact.email)) {
      count += 1;
    }
  }
  return count;
}

export function findCrossCustomerIdentifierConflicts(
  plans: CustomerIdentifierPlan[],
): MaskedIdentifierConflict[] {
  const byKey = new Map<
    string,
    {
      contactType: ContactIdentifierType;
      normalizedValue: string;
      customerIds: string[];
      customerCodes: Array<string | null>;
    }
  >();

  for (const plan of plans) {
    for (const identifier of plan.identifiers) {
      const key = `${identifier.contactType}|${identifier.normalizedValue}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          contactType: identifier.contactType,
          normalizedValue: identifier.normalizedValue,
          customerIds: [plan.customerId],
          customerCodes: [plan.customerCode],
        });
        continue;
      }
      if (!existing.customerIds.includes(plan.customerId)) {
        existing.customerIds.push(plan.customerId);
        existing.customerCodes.push(plan.customerCode);
      }
    }
  }

  const conflicts: MaskedIdentifierConflict[] = [];
  for (const entry of byKey.values()) {
    if (entry.customerIds.length < 2) continue;
    conflicts.push({
      contactType: entry.contactType,
      valueHash: sha12(entry.normalizedValue),
      maskedValue: maskNormalizedIdentifier(
        entry.contactType,
        entry.normalizedValue,
      ),
      customerIds: entry.customerIds,
      customerCodes: entry.customerCodes,
    });
  }
  return conflicts;
}

export function diffIdentifierSets(
  existing: BuiltContactIdentifier[],
  desired: BuiltContactIdentifier[],
): { insert: number; delete: number; keep: number } {
  const existingKeys = new Set(
    existing.map((row) => `${row.contactType}|${row.normalizedValue}`),
  );
  const desiredKeys = new Set(
    desired.map((row) => `${row.contactType}|${row.normalizedValue}`),
  );
  let keep = 0;
  let insert = 0;
  let del = 0;
  for (const key of desiredKeys) {
    if (existingKeys.has(key)) keep += 1;
    else insert += 1;
  }
  for (const key of existingKeys) {
    if (!desiredKeys.has(key)) del += 1;
  }
  return { insert, delete: del, keep };
}

async function loadPlans(db: Database): Promise<{
  plans: CustomerIdentifierPlan[];
  existingByCustomer: Map<string, BuiltContactIdentifier[]>;
}> {
  const customers = await db
    .select({
      id: schema.customers.id,
      customerCode: schema.customers.customerCode,
      status: schema.customers.status,
      phoneCountryCode: schema.customers.phoneCountryCode,
      phone: schema.customers.phone,
      wechatId: schema.customers.wechatId,
      email: schema.customers.email,
    })
    .from(schema.customers);

  const contacts = await db
    .select({
      customerId: schema.customerContacts.customerId,
      phone: schema.customerContacts.phone,
      wechatId: schema.customerContacts.wechatId,
      email: schema.customerContacts.email,
    })
    .from(schema.customerContacts);

  const contactsByCustomer = new Map<string, SecondaryContactInput[]>();
  for (const row of contacts) {
    const list = contactsByCustomer.get(row.customerId) ?? [];
    list.push({
      phone: row.phone,
      wechatId: row.wechatId,
      email: row.email,
    });
    contactsByCustomer.set(row.customerId, list);
  }

  const existingRows = await db
    .select({
      customerId: schema.customerContactIdentifiers.customerId,
      contactType: schema.customerContactIdentifiers.contactType,
      normalizedValue: schema.customerContactIdentifiers.normalizedValue,
    })
    .from(schema.customerContactIdentifiers);

  const existingByCustomer = new Map<string, BuiltContactIdentifier[]>();
  for (const row of existingRows) {
    const list = existingByCustomer.get(row.customerId) ?? [];
    list.push({
      contactType: row.contactType as ContactIdentifierType,
      normalizedValue: row.normalizedValue,
    });
    existingByCustomer.set(row.customerId, list);
  }

  const plans: CustomerIdentifierPlan[] = customers.map((customer) => {
    const secondaryContacts = contactsByCustomer.get(customer.id) ?? [];
    const input = {
      phoneCountryCode: customer.phoneCountryCode,
      phone: customer.phone,
      wechatId: customer.wechatId,
      email: customer.email,
      secondaryContacts,
    };
    return {
      customerId: customer.id,
      customerCode: customer.customerCode,
      status: customer.status,
      identifiers: buildCustomerContactIdentifiers(input),
      unnormalizableCount: countUnnormalizable(input),
    };
  });

  return { plans, existingByCustomer };
}

export async function runContactIdentifiersBackfillDryRun(
  db: Database,
): Promise<ContactIdentifiersBackfillDryRunResult> {
  const { plans, existingByCustomer } = await loadPlans(db);
  const conflicts = findCrossCustomerIdentifierConflicts(plans);

  let identifierCount = 0;
  let existingIdentifierCount = 0;
  let wouldInsert = 0;
  let wouldDelete = 0;
  let wouldKeep = 0;
  let unnormalizableCount = 0;

  for (const rows of existingByCustomer.values()) {
    existingIdentifierCount += rows.length;
  }

  for (const plan of plans) {
    identifierCount += plan.identifiers.length;
    unnormalizableCount += plan.unnormalizableCount;
    const existing = existingByCustomer.get(plan.customerId) ?? [];
    const diff = diffIdentifierSets(existing, plan.identifiers);
    wouldInsert += diff.insert;
    wouldDelete += diff.delete;
    wouldKeep += diff.keep;
  }

  return {
    mode: "dry-run",
    customersScanned: plans.length,
    identifierCount,
    existingIdentifierCount,
    wouldInsert,
    wouldDelete,
    wouldKeep,
    conflictCount: conflicts.length,
    conflicts,
    unnormalizableCount,
    safeToApply: conflicts.length === 0,
    rowsWritten: 0,
  };
}

/**
 * Read-only coverage check: expected vs actual identifiers (no PII).
 */
export async function verifyCustomerContactIdentifierCoverage(
  db: Database,
): Promise<ContactIdentifierCoverageResult> {
  const { plans, existingByCustomer } = await loadPlans(db);
  const customerMeta = new Map(
    plans.map((p) => [
      p.customerId,
      { customerCode: p.customerCode, status: p.status },
    ]),
  );

  const anomalies: MaskedCoverageAnomaly[] = [];
  let expectedIdentifierCount = 0;
  let actualIdentifierCount = 0;
  let missingCount = 0;
  let extraCount = 0;
  let ownershipMismatchCount = 0;
  let intraCustomerDuplicateCount = 0;
  let unnormalizableCount = 0;

  for (const plan of plans) {
    expectedIdentifierCount += plan.identifiers.length;
    unnormalizableCount += plan.unnormalizableCount;
    const existing = existingByCustomer.get(plan.customerId) ?? [];
    actualIdentifierCount += existing.length;

    const seen = new Set<string>();
    for (const row of existing) {
      const key = `${row.contactType}|${row.normalizedValue}`;
      if (seen.has(key)) {
        intraCustomerDuplicateCount += 1;
        anomalies.push({
          kind: "intra_customer_duplicate",
          contactType: row.contactType,
          maskedValue: maskNormalizedIdentifier(
            row.contactType,
            row.normalizedValue,
          ),
          valueHash: sha12(row.normalizedValue),
          customerCode: plan.customerCode,
          status: plan.status,
        });
      }
      seen.add(key);
    }

    const desiredKeys = new Set(
      plan.identifiers.map((r) => `${r.contactType}|${r.normalizedValue}`),
    );
    const existingKeys = new Set(
      existing.map((r) => `${r.contactType}|${r.normalizedValue}`),
    );

    for (const id of plan.identifiers) {
      const key = `${id.contactType}|${id.normalizedValue}`;
      if (!existingKeys.has(key)) {
        missingCount += 1;
        anomalies.push({
          kind: "missing",
          contactType: id.contactType,
          maskedValue: maskNormalizedIdentifier(
            id.contactType,
            id.normalizedValue,
          ),
          valueHash: sha12(id.normalizedValue),
          customerCode: plan.customerCode,
          status: plan.status,
        });
      }
    }

    for (const row of existing) {
      const key = `${row.contactType}|${row.normalizedValue}`;
      if (!desiredKeys.has(key)) {
        extraCount += 1;
        anomalies.push({
          kind: "extra",
          contactType: row.contactType,
          maskedValue: maskNormalizedIdentifier(
            row.contactType,
            row.normalizedValue,
          ),
          valueHash: sha12(row.normalizedValue),
          customerCode: plan.customerCode,
          status: plan.status,
        });
      }
    }
  }

  for (const [customerId, rows] of existingByCustomer) {
    if (customerMeta.has(customerId)) continue;
    for (const row of rows) {
      ownershipMismatchCount += 1;
      actualIdentifierCount += 1;
      anomalies.push({
        kind: "ownership_mismatch",
        contactType: row.contactType,
        maskedValue: maskNormalizedIdentifier(
          row.contactType,
          row.normalizedValue,
        ),
        valueHash: sha12(row.normalizedValue),
        customerCode: null,
        status: null,
      });
    }
  }

  const conflicts = findCrossCustomerIdentifierConflicts(plans);
  for (const conflict of conflicts) {
    for (let i = 0; i < conflict.customerIds.length; i += 1) {
      const customerId = conflict.customerIds[i]!;
      const meta = customerMeta.get(customerId);
      anomalies.push({
        kind: "cross_customer_conflict",
        contactType: conflict.contactType,
        maskedValue: conflict.maskedValue,
        valueHash: conflict.valueHash,
        customerCode: conflict.customerCodes[i] ?? meta?.customerCode ?? null,
        status: meta?.status ?? null,
      });
    }
  }

  const crossCustomerConflictCount = conflicts.length;
  const ok =
    missingCount === 0 &&
    extraCount === 0 &&
    ownershipMismatchCount === 0 &&
    crossCustomerConflictCount === 0;

  return {
    customersTotal: plans.length,
    expectedIdentifierCount,
    actualIdentifierCount,
    missingCount,
    extraCount,
    ownershipMismatchCount,
    intraCustomerDuplicateCount,
    crossCustomerConflictCount,
    unnormalizableCount,
    // Cap anomaly list to keep CLI output small (still counts are exact).
    anomalies: anomalies.slice(0, 50),
    ok,
  };
}

/**
 * Apply per-customer replace sync. Refuses when any cross-customer conflict exists.
 * Safe to re-run; does not truncate the whole identifiers table.
 * Runs coverage verification after apply; fails closed if coverage not clean.
 */
export async function runContactIdentifiersBackfillApply(
  db: Database,
  options?: { now?: string },
): Promise<ContactIdentifiersBackfillApplyResult> {
  const dryRun = await runContactIdentifiersBackfillDryRun(db);
  if (!dryRun.safeToApply || dryRun.conflictCount > 0) {
    throw new ContactIdentifiersBackfillError(
      "CROSS_CUSTOMER_CONFLICTS",
      `Refusing apply: ${dryRun.conflictCount} cross-customer identifier conflict(s)`,
    );
  }

  const { plans } = await loadPlans(db);
  const now = options?.now ?? new Date().toISOString();
  let inserted = 0;
  let deleted = 0;
  let kept = 0;
  let rowsWritten = 0;
  let identifierCount = 0;
  let unnormalizableCount = 0;

  for (const plan of plans) {
    identifierCount += plan.identifiers.length;
    unnormalizableCount += plan.unnormalizableCount;

    const before = await db
      .select({
        contactType: schema.customerContactIdentifiers.contactType,
        normalizedValue: schema.customerContactIdentifiers.normalizedValue,
      })
      .from(schema.customerContactIdentifiers)
      .where(eq(schema.customerContactIdentifiers.customerId, plan.customerId));

    const beforeSet = before.map((row) => ({
      contactType: row.contactType as ContactIdentifierType,
      normalizedValue: row.normalizedValue,
    }));
    const diff = diffIdentifierSets(beforeSet, plan.identifiers);
    inserted += diff.insert;
    deleted += diff.delete;
    kept += diff.keep;

    const customer = await db
      .select({
        phoneCountryCode: schema.customers.phoneCountryCode,
        phone: schema.customers.phone,
        wechatId: schema.customers.wechatId,
        email: schema.customers.email,
      })
      .from(schema.customers)
      .where(eq(schema.customers.id, plan.customerId))
      .then((rows) => rows[0]);

    if (!customer) continue;

    const secondaryContacts = await db
      .select({
        phone: schema.customerContacts.phone,
        wechatId: schema.customerContacts.wechatId,
        email: schema.customerContacts.email,
      })
      .from(schema.customerContacts)
      .where(eq(schema.customerContacts.customerId, plan.customerId));

    const sync = buildReplaceCustomerIdentifierStatements(db, {
      customerId: plan.customerId,
      phoneCountryCode: customer.phoneCountryCode,
      phone: customer.phone,
      wechatId: customer.wechatId,
      email: customer.email,
      secondaryContacts,
      now,
    });

    await db.batch(
      sync.statements as unknown as Parameters<Database["batch"]>[0],
    );
    rowsWritten += sync.identifiers.length;
  }

  const coverage = await verifyCustomerContactIdentifierCoverage(db);
  if (!coverage.ok) {
    throw new ContactIdentifiersBackfillError(
      "COVERAGE_INCOMPLETE",
      `Apply finished but coverage failed: missing=${coverage.missingCount} extra=${coverage.extraCount} ownershipMismatch=${coverage.ownershipMismatchCount} conflicts=${coverage.crossCustomerConflictCount}`,
    );
  }

  return {
    mode: "apply",
    customersScanned: plans.length,
    identifierCount,
    existingIdentifierCountBefore: dryRun.existingIdentifierCount,
    inserted,
    deleted,
    kept,
    conflictCount: 0,
    unnormalizableCount,
    customersSynced: plans.length,
    rowsWritten,
    coverage,
  };
}
