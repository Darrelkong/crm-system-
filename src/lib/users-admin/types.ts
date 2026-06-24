export type AdminUserView = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "active" | "disabled";
  failed_login_count: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
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
