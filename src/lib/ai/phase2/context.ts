import {
  PHASE2_LIMITS,
  type Phase2ContactAvailability,
  type Phase2Context,
  type Phase2FollowUpContext,
  type Phase2HeatSummary,
  type Phase2StageChange,
} from "@/lib/ai/phase2/types";

export type Phase2ContextPlainInput = {
  customerId: string;
  salesStage: string;
  requestedProjectName?: string | null;
  customerIntent?: string | null;
  initialNote?: string | null;
  source?: string | null;
  createdAt?: string | null;
  lastFollowUpAt?: string | null;
  lastValidFollowUpAt?: string | null;
  nextFollowUpAt?: string | null;
  contactAvailability?: Partial<Phase2ContactAvailability> | null;
  heat?: Partial<Phase2HeatSummary> | null;
  recentFollowUps?: Array<Partial<Phase2FollowUpContext> & { id: string }>;
  stageHistory?: Phase2StageChange[];
};

function defaultContactAvailability(
  partial?: Partial<Phase2ContactAvailability> | null,
): Phase2ContactAvailability {
  const hasPhone = !!partial?.hasPhone;
  const hasEmail = !!partial?.hasEmail;
  const hasWeChat = !!partial?.hasWeChat;
  const contactMethodCount =
    partial?.contactMethodCount ??
    [hasPhone, hasEmail, hasWeChat].filter(Boolean).length;
  const hasAnyContactMethod =
    partial?.hasAnyContactMethod ?? contactMethodCount > 0;
  const contactCompletenessLabel =
    partial?.contactCompletenessLabel ??
    (contactMethodCount === 0
      ? "none"
      : contactMethodCount === 1
        ? "partial"
        : "complete");
  return {
    hasPhone,
    hasEmail,
    hasWeChat,
    hasAnyContactMethod,
    contactMethodCount,
    contactCompletenessLabel,
  };
}

/**
 * Builds a Phase 2 context from plain fixtures / in-memory input.
 * Does not query D1. Not wired into the production insight pipeline.
 */
export function buildPhase2ContextFromPlain(
  input: Phase2ContextPlainInput,
): Phase2Context {
  const followUps = (input.recentFollowUps ?? [])
    .slice()
    .sort((a, b) => {
      const ta = a.followUpTime ?? "";
      const tb = b.followUpTime ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1; // newest first
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, PHASE2_LIMITS.followUpContextMax)
    .map((row) => ({
      id: row.id,
      followUpTime: row.followUpTime ?? "",
      channel: row.channel ?? "other",
      outcome: row.outcome ?? "contact_made",
      summary: row.summary ?? "",
      nextAction: row.nextAction ?? null,
      nextFollowUpAt: row.nextFollowUpAt ?? null,
      customerIntent: row.customerIntent ?? null,
      isValidFollowUp: row.isValidFollowUp ?? true,
    }));

  return {
    customerId: input.customerId,
    salesStage: input.salesStage,
    requestedProjectName: input.requestedProjectName ?? null,
    customerIntent: input.customerIntent ?? null,
    initialNote: input.initialNote ?? null,
    source: input.source ?? null,
    createdAt: input.createdAt ?? null,
    lastFollowUpAt: input.lastFollowUpAt ?? null,
    lastValidFollowUpAt: input.lastValidFollowUpAt ?? null,
    nextFollowUpAt: input.nextFollowUpAt ?? null,
    contactAvailability: defaultContactAvailability(input.contactAvailability),
    heat: {
      heatLevel: input.heat?.heatLevel ?? null,
      daysWithoutValidFollowUp: input.heat?.daysWithoutValidFollowUp ?? null,
      nextFollowUpOverdue: !!input.heat?.nextFollowUpOverdue,
      reclaimWarningLikely: !!input.heat?.reclaimWarningLikely,
    },
    recentFollowUps: followUps,
    stageHistory: (input.stageHistory ?? []).slice(
      0,
      PHASE2_LIMITS.stageHistoryMax,
    ),
  };
}
