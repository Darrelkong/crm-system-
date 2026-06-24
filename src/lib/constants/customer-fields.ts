export const CUSTOMER_TYPES = ["individual", "company"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  individual: "个人",
  company: "企业",
};

export const SALES_STAGES = [
  "new_lead",
  "contacted",
  "negotiating",
  "converted",
  "lost",
] as const;
export type SalesStage = (typeof SALES_STAGES)[number];

export const SALES_STAGE_LABELS: Record<SalesStage, string> = {
  new_lead: "新线索",
  contacted: "已联系",
  negotiating: "洽谈中",
  converted: "已成交",
  lost: "已流失",
};

export function isCustomerType(v: string): v is CustomerType {
  return (CUSTOMER_TYPES as readonly string[]).includes(v);
}

export function isSalesStage(v: string): v is SalesStage {
  return (SALES_STAGES as readonly string[]).includes(v);
}
