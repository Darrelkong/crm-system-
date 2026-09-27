import * as React from "react";
import { Field, Label, Select } from "@/components/ui/form";
import { CUSTOMER_RATINGS, type CustomerRatingValue } from "@/lib/customers/rating/domain";
import { requiresRatingSelection } from "@/lib/customers/rating/form-state";
export function FollowUpRatingFields({ currentRating, outcome, selectedRating, onChange, error, t }: {
  currentRating: CustomerRatingValue; outcome: string; selectedRating: string;
  onChange: (rating: string) => void; error?: string; t: (key: string) => string;
}) {
  return <Field>
    <p className="mb-2 text-sm text-[#6B7890]" data-testid="current-rating-reference">
      {t("followUps.currentRating")}: {currentRating ?? t("followUps.unrated")}
    </p>
    {requiresRatingSelection(outcome) ? <>
      <Label htmlFor="customerRating">{t("followUps.confirmRating")} <span className="text-red-500">*</span></Label>
      <Select id="customerRating" value={selectedRating} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("followUps.chooseRating")}</option>
        {CUSTOMER_RATINGS.map((rating) => <option key={rating} value={rating}>{rating}</option>)}
      </Select>
    </> : outcome ? <p className="text-sm">{t("followUps.ratingPreserved")}</p> : null}
    {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
  </Field>;
}
