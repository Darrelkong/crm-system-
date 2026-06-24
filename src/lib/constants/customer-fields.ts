export const CUSTOMER_TYPES = ["individual", "company"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  individual: "个人",
  company: "企业",
};

export const SALES_STAGES = [
  "new_lead",
  "contacted",
  "interested",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
  "on_hold",
] as const;
export type SalesStage = (typeof SALES_STAGES)[number];

/** Legacy values still accepted in DB records and validation */
export const LEGACY_SALES_STAGES = ["negotiating", "converted", "lost"] as const;
export type LegacySalesStage = (typeof LEGACY_SALES_STAGES)[number];

export const SALES_STAGE_LABELS: Record<SalesStage | LegacySalesStage, string> = {
  new_lead: "新线索",
  contacted: "已联系",
  interested: "有意向",
  proposal: "方案",
  negotiation: "谈判中",
  closed_won: "已成交",
  closed_lost: "已流失",
  on_hold: "搁置",
  negotiating: "洽谈中",
  converted: "已成交",
  lost: "已流失",
};

export function isCustomerType(v: string): v is CustomerType {
  return (CUSTOMER_TYPES as readonly string[]).includes(v);
}

export function isSalesStage(v: string): v is SalesStage | LegacySalesStage {
  return (
    (SALES_STAGES as readonly string[]).includes(v) ||
    (LEGACY_SALES_STAGES as readonly string[]).includes(v)
  );
}
