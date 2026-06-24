/** Stable English keys for follow-up channels. */
export const FOLLOW_UP_CHANNELS = [
  "phone",
  "wechat",
  "email",
  "meeting",
  "other",
] as const;

export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];

export const FOLLOW_UP_CHANNEL_LABELS: Record<FollowUpChannel, string> = {
  phone: "电话",
  wechat: "微信",
  email: "邮件",
  meeting: "会面",
  other: "其他",
};

export function isFollowUpChannel(value: string): value is FollowUpChannel {
  return (FOLLOW_UP_CHANNELS as readonly string[]).includes(value);
}
