import type { CustomerSourceKey } from "./customer-sources";

export const CUSTOMER_SOURCE_LABELS: Record<CustomerSourceKey, string> = {
  xianyu_taobao: "闲鱼 / 淘宝",
  xiaohongshu: "小红书",
  douyin: "抖音",
  referral: "转介绍",
  online_media: "线上媒体平台",
  agent_client: "代理客户",
  other: "其他",
};
