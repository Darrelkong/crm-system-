export type RecycleBinCustomerView = {
  id: string;
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
