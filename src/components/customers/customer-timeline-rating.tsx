import * as React from "react";
import type { TimelineRating } from "@/lib/customers/timeline/types";
import { formatHongKongDateTime } from "@/lib/timezone";

type Translate = (key: string, params?: Record<string, string>) => string;

/** Render only the stored decision snapshot, never the customer's current rating. */
export function CustomerTimelineRating({ rating, t, linked }: {
  rating: TimelineRating; t: Translate; linked: boolean;
}) {
  const before = rating.ratingBefore ?? t("followUps.unrated");
  const after = rating.ratingAfter ?? t("followUps.unrated");
  const transition = rating.ratingBefore === rating.ratingAfter
    ? t("customerRating.historyMaintained", { rating: after })
    : `${before} → ${after}`;
  return <div className="mt-2 min-w-0 space-y-1 text-sm crm-text-secondary" data-testid="timeline-rating">
    <p className="text-xs font-medium">{t("customerRating.title")}</p>
    <p>{transition}</p>
    {linked && <p className="text-xs crm-text-muted">
      {t("customerRating.historyRecordedAt", { time: formatHongKongDateTime(rating.ratingRecordedAt) })}
      {" · "}{t("customers.timelineActor", { name: rating.actorName || t("timelineMessages.unknownActor") })}
    </p>}
    {rating.followUpUnavailable && <p className="text-xs crm-text-muted">{t("customerRating.historyFollowUpUnavailable")}</p>}
    {rating.ratingReason && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {t("customerRating.historyReason", { reason: rating.ratingReason })}
    </p>}
  </div>;
}
