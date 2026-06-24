import type { CustomerSourceKey } from "@/lib/constants/customer-sources";

/** UI labels keyed by stable database source keys. Phase 1+ will load by locale. */
export const customerSourceLabelsZhCN: Record<CustomerSourceKey, string> = {
  xianyu_taobao: "闲鱼 / 淘宝",
  xiaohongshu: "小红书",
  douyin: "抖音",
  referral: "转介绍",
  online_media: "线上媒体平台",
  agent_client: "代理客户",
  other: "其他",
};

export const commonZhCN = {
  appName: "CRM 系统",
  phase0Title: "基础设施已就绪",
  phase0Description:
    "Cloudflare D1 数据库与项目骨架已配置。登录、客户管理等功能将在后续阶段实现。",
} as const;
