import type { AuthorizedDeviceStatus } from "../../../drizzle/schema/authorized-devices";

export type DeviceListItem = {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  device_id_hash: string;
  device_name: string | null;
  user_agent: string | null;
  user_agent_summary: string | null;
  ip_address: string | null;
  status: AuthorizedDeviceStatus;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  last_seen_ip: string | null;
  created_at: string;
  updated_at: string;
};

export type DeviceUserSummary = {
  user_id: string;
  approved_count: number;
  limit: number;
};

export type DeviceLoginBlockReason =
  | "new_pending"
  | "pending"
  | "rejected"
  | "revoked"
  | "limit_reached"
  | "reapproval_pending";
