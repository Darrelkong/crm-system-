import { isFollowUpOutcome } from "@/lib/constants/follow-up-outcomes";
import { FOLLOW_UP_RATING_POLICY, type CustomerRatingValue } from "./domain";
export function requiresRatingSelection(outcome: string): boolean {
  return isFollowUpOutcome(outcome) && FOLLOW_UP_RATING_POLICY[outcome] === "required";
}
export function changeFollowUpField<T extends { customerRating: string }>(form: T, field: string, value: string): T {
  return { ...form, [field]: value, ...(field === "outcome" ? { customerRating: "" } : {}) };
}
/** Retain every unsaved field; a changed revision always requires a fresh human choice. */
export function refreshRatingReference<T extends { customerRating: string }>(form: T,
  customerRating: CustomerRatingValue, customerRatingRevision: number) {
  return { form: { ...form, customerRating: "" }, reference: { customerRating, customerRatingRevision } };
}
