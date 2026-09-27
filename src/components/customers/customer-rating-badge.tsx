import * as React from "react";
import { cn } from "@/lib/cn";
import type { CustomerRatingValue } from "@/lib/customers/rating/domain";
const colors = {
  S: "bg-violet-50 text-violet-800 ring-violet-200",
  A: "bg-blue-50 text-blue-800 ring-blue-200",
  B: "bg-teal-50 text-teal-800 ring-teal-200",
  D: "bg-slate-100 text-slate-700 ring-slate-200",
};
/** Human judgment only; never merge a reclamation countdown into this badge. */
export function CustomerRatingBadge({ rating, unratedLabel, title }: {
  rating: CustomerRatingValue; unratedLabel: string; title?: string;
}) {
  return <span data-testid="customer-rating" title={title} aria-label={title ? `${title}: ${rating ?? unratedLabel}` : undefined}
    className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
      rating === null ? "bg-slate-50 text-slate-500 ring-slate-200" : colors[rating])}>{rating ?? unratedLabel}</span>;
}
