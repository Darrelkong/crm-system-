import { and, eq, notInArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import { getSystemSettings } from "@/lib/settings/service";
import {
  getCollaborativeCustomerIds,
  getCollaboratorCountsByCustomerId,
} from "./collaborative";
import { RECLAMATION_EXCLUDED_SALES_STAGES } from "./constants";
import { getDaysWithoutValidFollowUp } from "./days";

/** Default idle threshold before a collaborative customer is a dissolution candidate. */
export const COLLABORATIVE_DISSOLUTION_THRESHOLD_DAYS = 90;

export type CollaborativeDissolutionDryRunCandidate = {
  customerId: string;
  customerName: string;
  customerCode: string | null;
  ownerId: string | null;
  createdBy: string;
  lastValidFollowUpAt: string | null;
  createdAt: string;
  daysWithoutValidFollowUp: number;
  collaboratorCount: number;
};

export type CollaborativeDissolutionDryRunResult = {
  enabled: boolean;
  thresholdDays: number;
  totalCandidates: number;
  candidates: CollaborativeDissolutionDryRunCandidate[];
};

type DryRunCustomerRow = {
  id: string;
  customerName: string;
  customerCode: string | null;
  ownerId: string | null;
  createdBy: string;
  lastValidFollowUpAt: string | null;
  createdAt: string;
};

export function parseCollaborativeDissolutionEnabled(
  settings: Record<string, string>,
): boolean {
  return settings.collaborative_dissolution_enabled === "true";
}

/**
 * Read-only dry-run report: collaborative customers idle for >= thresholdDays
 * without a valid follow-up. Does not modify any data.
 */
export async function getCollaborativeDissolutionDryRun(
  db: Database,
  options?: { now?: Date; thresholdDays?: number },
): Promise<CollaborativeDissolutionDryRunResult> {
  const settings = await getSystemSettings(db);
  const enabled = parseCollaborativeDissolutionEnabled(settings);
  const thresholdDays =
    options?.thresholdDays ?? COLLABORATIVE_DISSOLUTION_THRESHOLD_DAYS;
  const now = options?.now ?? new Date();

  const eligibleCustomers: DryRunCustomerRow[] = await db
    .select({
      id: schema.customers.id,
      customerName: schema.customers.customerName,
      customerCode: schema.customers.customerCode,
      ownerId: schema.customers.ownerId,
      createdBy: schema.customers.createdBy,
      lastValidFollowUpAt: schema.customers.lastValidFollowUpAt,
      createdAt: schema.customers.createdAt,
    })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "active"),
        eq(schema.customers.isPinned, 0),
        notInArray(
          schema.customers.salesStage,
          [...RECLAMATION_EXCLUDED_SALES_STAGES],
        ),
      ),
    );

  const collaborativeCustomerIds = await getCollaborativeCustomerIds(
    db,
    eligibleCustomers.map((customer) => customer.id),
  );

  const preliminaryCandidates: CollaborativeDissolutionDryRunCandidate[] = [];

  for (const customer of eligibleCustomers) {
    if (!collaborativeCustomerIds.has(customer.id)) {
      continue;
    }

    const daysWithoutValidFollowUp = getDaysWithoutValidFollowUp(
      customer as Customer,
      now,
    );

    if (daysWithoutValidFollowUp < thresholdDays) {
      continue;
    }

    preliminaryCandidates.push({
      customerId: customer.id,
      customerName: customer.customerName,
      customerCode: customer.customerCode,
      ownerId: customer.ownerId,
      createdBy: customer.createdBy,
      lastValidFollowUpAt: customer.lastValidFollowUpAt,
      createdAt: customer.createdAt,
      daysWithoutValidFollowUp,
      collaboratorCount: 0,
    });
  }

  if (preliminaryCandidates.length > 0) {
    const collaboratorCounts = await getCollaboratorCountsByCustomerId(
      db,
      preliminaryCandidates.map((candidate) => candidate.customerId),
    );

    for (const candidate of preliminaryCandidates) {
      candidate.collaboratorCount =
        collaboratorCounts.get(candidate.customerId) ?? 0;
    }
  }

  return {
    enabled,
    thresholdDays,
    totalCandidates: preliminaryCandidates.length,
    candidates: preliminaryCandidates,
  };
}
