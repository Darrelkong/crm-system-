export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { AdminReportsView } from "@/components/reports/admin-reports-view";
import { StaffReportsView } from "@/components/reports/staff-reports-view";

export default async function ReportsPage() {
  const user = await requireAuthCached();

  if (user.role === "admin") {
    return <AdminReportsView />;
  }

  return <StaffReportsView user={user} />;
}
