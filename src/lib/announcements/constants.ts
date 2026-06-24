export const ANNOUNCEMENT_AUDIT_ACTIONS = {
  created: "announcement.created",
  updated: "announcement.updated",
  published: "announcement.published",
  archived: "announcement.archived",
} as const;

export const ANNOUNCEMENT_AUDIENCES = ["all", "admin", "staff"] as const;
export type AnnouncementAudienceOption = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_AUDIENCE_LABELS = {
  all: "所有人",
  admin: "仅管理员",
  staff: "仅员工",
} as const;

export const ANNOUNCEMENT_STATUS_LABELS = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
} as const;
