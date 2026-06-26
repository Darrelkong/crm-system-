export type AdminUserView = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "active" | "disabled" | "deleted";
  failed_login_count: number;
  locked_until: string | null;
  is_locked: boolean;
  lockout_exempt: boolean;
  last_failed_login_at: string | null;
  locked_at: string | null;
  lock_reason: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by_name: string | null;
  transferred_customer_count: number | null;
  transferred_to_admin_name: string | null;
  last_login_at: string | null;
  recent_login_count: number;
};

export type LoginLogView = {
  id: string;
  email: string;
  success: boolean;
  failure_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};
