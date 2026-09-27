import { isCustomerRatingValue, type CustomerRatingValue } from "./domain";
export type RatingReference = { customerRating: CustomerRatingValue; customerRatingRevision: number };
export type CorrectionInput = { rating: CustomerRatingValue; expectedRevision: number; reason: string };
export function validCorrectionSelection(selection: string, reason: string): boolean {
  return (selection === "unrated" || isCustomerRatingValue(selection)) && Array.from(reason.trim()).length >= 5;
}
export function readRatingReference(value: Record<string, unknown>): RatingReference | null {
  return isCustomerRatingValue(value.customerRating) && typeof value.customerRatingRevision === "number"
    && Number.isSafeInteger(value.customerRatingRevision) && value.customerRatingRevision >= 0
    ? { customerRating: value.customerRating, customerRatingRevision: value.customerRatingRevision } : null;
}
export function newerRatingReference(current: RatingReference, next: RatingReference): RatingReference {
  return next.customerRatingRevision >= current.customerRatingRevision ? next : current;
}
/** One identity per logical body, reused after response loss; no automatic retry. */
export function createRatingCorrectionFlight() {
  let locked = false, fingerprint = "", submissionId = "";
  return {
    async submit(customerId: string, input: CorrectionInput, fetchImpl: typeof fetch = fetch): Promise<Response | null> {
      if (locked) return null;
      locked = true;
      try {
        const body = { ...input, reason: input.reason.trim() };
        const nextFingerprint = JSON.stringify([customerId, body]);
        if (fingerprint !== nextFingerprint) { fingerprint = nextFingerprint; submissionId = crypto.randomUUID(); }
        return await fetchImpl(`/api/customers/${customerId}/rating`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, submissionId }) });
      } finally { locked = false; }
    },
  };
}
