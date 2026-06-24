import type { HeatLevel } from "./types";

export const HEAT_LEVEL_LABELS: Record<HeatLevel, string> = {
  high: "高热度",
  medium: "中热度",
  low: "低热度",
  silent: "沉寂",
  high_churn_risk: "流失高风险",
};

export const HEAT_LEVEL_BADGE_CLASS: Record<HeatLevel, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-blue-100 text-blue-800",
  low: "bg-slate-100 text-slate-700",
  silent: "bg-slate-200 text-slate-600",
  high_churn_risk: "bg-red-100 text-red-800",
};

export const HIGH_ENGAGEMENT_STAGES = new Set([
  "interested",
  "proposal",
  "negotiation",
]);

export const LOW_ACTIVITY_STAGES = new Set(["new_lead", "contacted"]);

/** User-facing labels for completeness missing fields (full access only). */
export const COMPLETENESS_FIELD_LABELS: Record<string, string> = {
  customer_name: "客户名称",
  phone_or_wechat: "电话或微信",
  email: "Email",
  source: "客户来源",
  sales_stage: "销售阶段",
  owner_id: "负责人",
  notes: "备注",
  follow_up: "至少一条跟进记录",
  next_follow_up_at: "下次跟进时间",
};

export const LOW_COMPLETENESS_THRESHOLD = 60;
