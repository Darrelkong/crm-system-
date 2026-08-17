/**
 * Production shadow bridge (C3). Keeps scoring/service.ts changes minimal.
 */

import type { Customer } from "../../../../drizzle/schema/customers";
import type { FollowUp } from "../../../../drizzle/schema/follow-ups";
import type { EffectiveSettings } from "@/lib/settings/effective";
import type { User } from "../../../../drizzle/schema/users";
import {
  buildStateV2ShadowDetailRequestSeed,
  buildStateV2ShadowListRequestSeed,
  maybeRunStateV2ShadowBatch,
} from "@/lib/customers/state/shadow";
import type { CustomerScores } from "./types";

export function invokeStateV2ShadowForListBatch(input: {
  user: User;
  customers: readonly Customer[];
  scoresByCustomerId: ReadonlyMap<string, CustomerScores>;
  hasFollowUpByCustomerId: ReadonlySet<string>;
  settings: EffectiveSettings;
  now?: Date;
}): void {
  try {
    maybeRunStateV2ShadowBatch({
      requestSeed: buildStateV2ShadowListRequestSeed(
        input.user.id,
        input.customers,
      ),
      route: "list",
      settings: input.settings,
      now: input.now,
      customers: input.customers.map((customer) => ({
        customer,
        legacyScores: input.scoresByCustomerId.get(customer.id)!,
        hasFollowUp: input.hasFollowUpByCustomerId.has(customer.id),
      })),
    });
  } catch {
    // Shadow must never affect the primary response path.
  }
}

export function invokeStateV2ShadowForDetail(input: {
  user: User;
  customer: Customer;
  legacyScores: CustomerScores;
  settings: EffectiveSettings;
  hasFollowUp: boolean;
  followUps?: readonly FollowUp[];
  hasCollaborator?: boolean;
  now?: Date;
}): void {
  try {
    maybeRunStateV2ShadowBatch({
      requestSeed: buildStateV2ShadowDetailRequestSeed(
        input.user.id,
        input.customer.id,
      ),
      route: "detail",
      settings: input.settings,
      now: input.now,
      customers: [
        {
          customer: input.customer,
          legacyScores: input.legacyScores,
          hasFollowUp: input.hasFollowUp,
          followUpOutcomes: input.followUps?.map((row) => ({
            outcome: row.outcome,
            followUpTime: row.followUpTime,
          })),
          hasCollaborator: input.hasCollaborator,
        },
      ],
    });
  } catch {
    // Shadow must never affect the primary response path.
  }
}
