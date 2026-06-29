export type RecycleBinCustomerView = {
  id: string;
  customer_code: string | null;
  customer_name: string;
  phone: string | null;
  email: string | null;
  sales_stage: string;
  owner_id: string | null;
  owner_name: string | null;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  deleted_reason: string | null;
  created_at: string;
  updated_at: string;
  remaining_retention_days: number;
};

export type ExpiredRecycleBinCustomerPreview = {
  id: string;
  customerName: string;
  customerCode?: string | null;
  deletedAt: string;
  deletedByName?: string | null;
  deletedReason?: string | null;
  remainingRetentionDays: number;
};

export type ExpiredRecycleBinPreviewResult = {
  cutoff: string;
  expiredCount: number;
  customers: ExpiredRecycleBinCustomerPreview[];
};
