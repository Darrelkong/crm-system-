import type {
  CustomerSourceKey,
  InternalCustomerSourceKey,
} from "./customer-sources";
import { PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY } from "./customer-sources";

export const CUSTOMER_SOURCE_LABELS: Record<CustomerSourceKey, string> = {
  xianyu_taobao: "淘宝",
  xiaohongshu: "小红书",
  douyin: "抖音",
  referral: "客户转介绍",
  online_media: "其他媒体平台（历史未细分）",
  agent_client: "代理渠道",
  other: "其他",
};

/** Fallback ZH labels for internal/hidden sources (reports / tag map). */
export const INTERNAL_CUSTOMER_SOURCE_LABELS: Record<
  InternalCustomerSourceKey,
  string
> = {
  [PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY]: "公共池快速录入（历史）",
};
