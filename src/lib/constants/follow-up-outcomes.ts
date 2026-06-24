/** Stable English keys for follow-up outcomes. */
export const FOLLOW_UP_OUTCOMES = [
  "contact_made",
  "no_contact",
  "replied",
  "no_reply",
  "interested",
  "considering",
  "not_interested",
  "awaiting_documents",
  "awaiting_quotation",
  "awaiting_internal_confirmation",
  "lost_contact",
] as const;

export type FollowUpOutcome = (typeof FOLLOW_UP_OUTCOMES)[number];

export const FOLLOW_UP_OUTCOME_LABELS: Record<FollowUpOutcome, string> = {
  contact_made: "已联系上",
  no_contact: "未联系上",
  replied: "已回复",
  no_reply: "未回复",
  interested: "有意向",
  considering: "考虑中",
  not_interested: "无意向",
  awaiting_documents: "等待资料",
  awaiting_quotation: "等待报价",
  awaiting_internal_confirmation: "等待内部确认",
  lost_contact: "失联",
};

/** Outcomes that count as a valid follow-up. */
export const VALID_FOLLOW_UP_OUTCOMES = [
  "contact_made",
  "replied",
  "interested",
  "considering",
  "awaiting_documents",
  "awaiting_quotation",
  "awaiting_internal_confirmation",
] as const satisfies readonly FollowUpOutcome[];

export function isFollowUpOutcome(value: string): value is FollowUpOutcome {
  return (FOLLOW_UP_OUTCOMES as readonly string[]).includes(value);
}

export function isValidFollowUpOutcome(outcome: FollowUpOutcome): boolean {
  return (VALID_FOLLOW_UP_OUTCOMES as readonly string[]).includes(outcome);
}
