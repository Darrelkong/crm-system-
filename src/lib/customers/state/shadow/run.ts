import type { Customer } from "../../../../../drizzle/schema/customers";
import type { FollowUp } from "../../../../../drizzle/schema/follow-ups";
import type { EffectiveSettings } from "@/lib/settings/effective";
import type { CustomerScores } from "@/lib/customers/scoring/types";
import {
  evaluateCustomerStateReference,
} from "../state-list-reference";
import type { FollowUpOutcomeFact } from "../types";
import {
  isShadowCircuitOpen,
  recordShadowFailure,
  recordShadowSuccess,
} from "./circuit-breaker";
import { isStateV2ShadowGloballyEnabled } from "./config";
import { recordLegacyToV2Comparisons } from "./compare";
import { isShadowSampleRequest } from "./sampling";
import {
  recordShadowCustomerCompared,
  recordShadowError,
  recordShadowRequestConsidered,
  recordShadowRequestSampled,
  recordShadowRequestSkippedCircuitOpen,
  recordShadowRequestSkippedDisabled,
  recordShadowRequestSkippedUnsampled,
  recordShadowSkippedInsufficientFacts,
} from "./telemetry";
import {
  maybeEmitShadowTelemetryLog,
  noteShadowCustomersComparedForEmit,
} from "./telemetry-log";

export type StateV2ShadowRoute = "list" | "detail";

export type StateV2ShadowCustomerInput = {
  customer: Customer;
  legacyScores: CustomerScores;
  hasFollowUp: boolean;
  followUpOutcomes?: readonly FollowUpOutcomeFact[];
  hasCollaborator?: boolean;
};

export type StateV2ShadowBatchInput = {
  requestSeed: string;
  route: StateV2ShadowRoute;
  settings: EffectiveSettings;
  now?: Date;
  customers: readonly StateV2ShadowCustomerInput[];
};

const MAX_SHADOW_CUSTOMERS_PER_REQUEST = 40;

export function buildStateV2ShadowListRequestSeed(
  actorUserId: string,
  customers: readonly Customer[],
): string {
  if (customers.length === 0) {
    return `list:${actorUserId}:empty`;
  }
  const firstId = customers[0]!.id;
  const lastId = customers[customers.length - 1]!.id;
  return `list:${actorUserId}:${customers.length}:${firstId}:${lastId}`;
}

export function buildStateV2ShadowDetailRequestSeed(
  actorUserId: string,
  customerId: string,
): string {
  return `detail:${actorUserId}:${customerId}`;
}

export function maybeRunStateV2ShadowBatch(
  input: StateV2ShadowBatchInput,
): void {
  recordShadowRequestConsidered();
  let comparedThisBatch = 0;

  try {
    if (!isStateV2ShadowGloballyEnabled()) {
      recordShadowRequestSkippedDisabled();
      return;
    }

    if (isShadowCircuitOpen()) {
      recordShadowRequestSkippedCircuitOpen();
      return;
    }

    if (!isShadowSampleRequest(input.requestSeed)) {
      recordShadowRequestSkippedUnsampled();
      return;
    }

    if (input.customers.length > MAX_SHADOW_CUSTOMERS_PER_REQUEST) {
      recordShadowSkippedInsufficientFacts();
      return;
    }

    recordShadowRequestSampled();

    const now = input.now ?? new Date();
    for (const entry of input.customers) {
      if (
        input.route === "detail" &&
        entry.followUpOutcomes === undefined
      ) {
        recordShadowSkippedInsufficientFacts();
        continue;
      }

      const followUps = toFollowUpRows(entry.followUpOutcomes);
      const snapshot = evaluateCustomerStateReference(
        entry.customer,
        followUps,
        now,
        {
          businessTimezone: input.settings.businessTimezone,
          automaticReclaimDays: input.settings.automaticReclaimDays,
          hasCollaborator: entry.hasCollaborator ?? false,
        },
      );

      recordLegacyToV2Comparisons(entry.legacyScores, snapshot);
      recordShadowCustomerCompared();
      comparedThisBatch += 1;
    }
    recordShadowSuccess();
  } catch {
    recordShadowError();
    recordShadowFailure();
  } finally {
    noteShadowCustomersComparedForEmit(comparedThisBatch);
    maybeEmitShadowTelemetryLog(input.now?.getTime());
  }
}

function toFollowUpRows(
  outcomes: readonly FollowUpOutcomeFact[] | undefined,
): FollowUp[] {
  if (!outcomes) return [];
  return outcomes.map((row, index) => ({
    id: `shadow-fu-${index}`,
    customerId: "shadow",
    userId: "shadow",
    followUpTime: row.followUpTime ?? "2026-01-01T00:00:00.000Z",
    channel: "phone",
    outcome: row.outcome,
    summary: "",
    customerIntent: null,
    nextAction: null,
    isValidFollowUp: 1,
    content: null,
    followUpType: null,
    nextFollowUpAt: null,
    createdAt: row.followUpTime ?? "2026-01-01T00:00:00.000Z",
  })) as FollowUp[];
}
