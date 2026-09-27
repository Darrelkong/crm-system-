import type { CustomerRatingAction, CustomerRatingValue } from "@/lib/customers/rating/domain";

export type TimelineRating = {
  eventId: string;
  ratingBefore: CustomerRatingValue;
  ratingAfter: CustomerRatingValue;
  ratingAction: CustomerRatingAction;
  ratingRecordedAt: string;
  ratingReason: string | null;
  actorName: string;
  followUpUnavailable: boolean;
};

export type TimelineItemType =
  | "audit"
  | "field_change"
  | "follow_up"
  | "task"
  | "approval"
  | "rating";

export type TimelineItem = {
  id: string;
  type: TimelineItemType;
  titleKey: string;
  titleParams?: Record<string, string>;
  descriptionKey?: string;
  descriptionParams?: Record<string, string>;
  /** Raw system message (e.g. auto-reclaim warnings with rule snapshot). */
  descriptionText?: string;
  /** Canonical saved follow-up action; omitted for masked visibility. */
  nextAction?: string | null;
  /** Structured human decision snapshot; FULL access only. */
  rating?: TimelineRating;
  actorName: string;
  actorIsSystem?: boolean;
  occurredAt: string;
  metadata: Record<string, unknown>;
  sensitive: boolean;
};

export type TimelineResponse = {
  items: TimelineItem[];
  accessLevel: "full" | "masked" | "archived_basic";
};
