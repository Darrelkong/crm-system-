import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  CheckSquare,
  CircleHelp,
  Database,
  Download,
  FileText,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  UserCog,
  UserPlus,
  Users,
  Waves,
} from "lucide-react";

export type NavIconId =
  | "dashboard"
  | "customers"
  | "addCustomer"
  | "followUps"
  | "publicPool"
  | "approvals"
  | "reports"
  | "notifications"
  | "announcementManagement"
  | "announcements"
  | "aiSettings"
  | "userManagement"
  | "tagsStages"
  | "recycleBin"
  | "systemSettings"
  | "loginLogs"
  | "securityPolicies"
  | "backups"
  | "customerImport"
  | "dataExport"
  | "help";

export const navIcons: Record<NavIconId, LucideIcon> = {
  dashboard: LayoutDashboard,
  customers: Users,
  addCustomer: UserPlus,
  followUps: FileText,
  publicPool: Waves,
  approvals: CheckSquare,
  reports: BarChart3,
  notifications: Bell,
  announcementManagement: Megaphone,
  announcements: Megaphone,
  aiSettings: Sparkles,
  userManagement: UserCog,
  tagsStages: Tags,
  recycleBin: Trash2,
  systemSettings: Settings,
  loginLogs: ScrollText,
  securityPolicies: Shield,
  backups: Database,
  customerImport: Upload,
  dataExport: Download,
  help: CircleHelp,
};
