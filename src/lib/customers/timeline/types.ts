export type TimelineItemType =
  | "audit"
  | "field_change"
  | "follow_up"
  | "task"
  | "approval";

export type TimelineItem = {
  id: string;
  type: TimelineItemType;
  title: string;
  description: string;
  actorName: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  sensitive: boolean;
};

export type TimelineResponse = {
  items: TimelineItem[];
  accessLevel: "full" | "masked" | "archived_basic";
};
