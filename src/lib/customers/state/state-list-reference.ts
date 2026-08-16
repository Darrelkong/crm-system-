/**
 * JS reference filter path for Customer State Engine V2 parity tests (C2).
 */

import type { Customer } from "../../../../drizzle/schema/customers";
import type { FollowUp } from "../../../../drizzle/schema/follow-ups";
import {
  buildCustomerListPagination,
  CUSTOMER_LIST_PAGE_SIZE,
} from "@/lib/customers/queries";
import { computeCustomerState } from "./engine";
import { DEFAULT_CUSTOMER_STATE_RULES, type CustomerStateRules } from "./rules";
import {
  buildStateListFilterSql,
  buildStateDimensionColumns,
  type StateListFilter,
} from "./state-sql-dimensions";
import { buildStateSqlClock } from "./state-sql-primitives";
import type {
  AttentionLevel,
  ChurnLevel,
  CustomerProfileFacts,
  CustomerStateFacts,
  EngagementState,
  FirstContactState,
  FollowUpSlaState,
  ProfileVerdict,
  ReclamationRiskState,
} from "./types";
import type { BusinessTimezone } from "@/lib/settings/effective";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";

export type StateDimensionSnapshot = {
  id: string;
  profileVerdict: ProfileVerdict;
  firstContact: FirstContactState;
  followUpSla: FollowUpSlaState;
  engagement: EngagementState;
  churnLevel: ChurnLevel;
  reclamationRisk: ReclamationRiskState;
  attentionLevel: AttentionLevel;
};

export function customerRowToProfileFacts(
  customer: Customer,
): CustomerProfileFacts {
  return {
    customerName: customer.customerName,
    nameStatus: customer.nameStatus,
    phone: customer.phone,
    wechatId: customer.wechatId,
    email: customer.email,
    requestedProjectCode: customer.requestedProjectCode,
    primaryConcern: customer.primaryConcern,
    notes: customer.notes,
    targetCountryOrRegion: customer.targetCountryOrRegion,
    preferredContactMethod: customer.preferredContactMethod,
    preferredName: customer.preferredName,
    gender: customer.gender,
    ageRange: customer.ageRange,
    preferredLanguage: customer.preferredLanguage,
    occupation: customer.occupation,
    companyName: customer.companyName,
    jobTitle: customer.jobTitle,
  };
}

export function buildStateFactsFromCustomerRow(
  customer: Customer,
  followUps: FollowUp[],
  options: {
    hasCollaborator?: boolean;
    businessTimezone?: BusinessTimezone;
    automaticReclaimDays?: number;
  } = {},
): CustomerStateFacts {
  return {
    salesStage: customer.salesStage,
    status: customer.status,
    ownerId: customer.ownerId,
    hasCollaborator: options.hasCollaborator ?? false,
    isPinned: customer.isPinned,
    createdAt: customer.createdAt,
    lastValidFollowUpAt: customer.lastValidFollowUpAt,
    nextFollowUpAt: customer.nextFollowUpAt,
    reclamationCycleStartedAt: customer.reclamationCycleStartedAt,
    reclaimRuleGraceUntil: customer.reclaimRuleGraceUntil,
    followUpOutcomes: followUps.map((row) => ({
      outcome: row.outcome,
      followUpTime: row.followUpTime,
    })),
    profile: customerRowToProfileFacts(customer),
    businessTimezone: options.businessTimezone ?? HONG_KONG_TIMEZONE,
    automaticReclaimDays: options.automaticReclaimDays ?? 55,
  };
}

export function evaluateCustomerStateReference(
  customer: Customer,
  followUps: FollowUp[],
  now: Date,
  options: {
    rules?: CustomerStateRules;
    hasCollaborator?: boolean;
    businessTimezone?: BusinessTimezone;
    automaticReclaimDays?: number;
  } = {},
): StateDimensionSnapshot {
  const rules = options.rules ?? DEFAULT_CUSTOMER_STATE_RULES;
  const facts = buildStateFactsFromCustomerRow(customer, followUps, options);
  const state = computeCustomerState(facts, rules, now);
  return {
    id: customer.id,
    profileVerdict: state.profileCompleteness.verdict,
    firstContact: state.firstContact.state,
    followUpSla: state.followUpSla.state,
    engagement: state.engagementHealth.state,
    churnLevel: state.churnRisk.level,
    reclamationRisk: state.reclamationRisk.state,
    attentionLevel: state.attentionLevel.level,
  };
}

export function filterCustomerIdsReference(
  snapshots: StateDimensionSnapshot[],
  filter: StateListFilter,
): string[] {
  return snapshots
    .filter((snapshot) => {
      if (
        filter.profileVerdict !== undefined &&
        snapshot.profileVerdict !== filter.profileVerdict
      ) {
        return false;
      }
      if (
        filter.firstContact !== undefined &&
        snapshot.firstContact !== filter.firstContact
      ) {
        return false;
      }
      if (
        filter.followUpSla !== undefined &&
        snapshot.followUpSla !== filter.followUpSla
      ) {
        return false;
      }
      if (
        filter.engagement !== undefined &&
        snapshot.engagement !== filter.engagement
      ) {
        return false;
      }
      if (
        filter.churnLevel !== undefined &&
        snapshot.churnLevel !== filter.churnLevel
      ) {
        return false;
      }
      if (
        filter.reclamationRisk !== undefined &&
        snapshot.reclamationRisk !== filter.reclamationRisk
      ) {
        return false;
      }
      if (
        filter.attentionLevel !== undefined &&
        snapshot.attentionLevel !== filter.attentionLevel
      ) {
        return false;
      }
      return true;
    })
    .map((snapshot) => snapshot.id);
}

export function paginateCustomerIdsReference(
  orderedIds: string[],
  matchingIds: Set<string>,
  page: number,
  pageSize: number = CUSTOMER_LIST_PAGE_SIZE,
): {
  pageIds: string[];
  total: number;
  pagination: ReturnType<typeof buildCustomerListPagination>;
} {
  const filtered = orderedIds.filter((id) => matchingIds.has(id));
  const pagination = buildCustomerListPagination(filtered.length, page, pageSize);
  const offset = (pagination.page - 1) * pagination.pageSize;
  return {
    pageIds: filtered.slice(offset, offset + pagination.pageSize),
    total: filtered.length,
    pagination,
  };
}

/** Convenience for isolated tests: SQL column objects with same clock as JS path. */
export function buildReferenceDimensionColumns(
  now: Date,
  options: {
    rules?: CustomerStateRules;
    businessTimezone?: BusinessTimezone;
    automaticReclaimDays?: number;
  } = {},
) {
  const timezone = options.businessTimezone ?? HONG_KONG_TIMEZONE;
  const clock = buildStateSqlClock(now, timezone);
  return buildStateDimensionColumns({
    rules: options.rules,
    clock,
    automaticReclaimDays: options.automaticReclaimDays ?? 55,
  });
}

export function matchesStateFilterSql(
  snapshot: StateDimensionSnapshot,
  filter: StateListFilter,
): boolean {
  const ids = filterCustomerIdsReference([snapshot], filter);
  return ids.length === 1;
}
