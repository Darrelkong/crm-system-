export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { AdminReportsView } from "@/components/reports/admin-reports-view";
import { StaffReportsView } from "@/components/reports/staff-reports-view";

export default async function ReportsPage() {
  const user = await requireAuth();

  if (user.role === "admin") {
    return <AdminReportsView />;
  }

  return <StaffReportsView user={user} />;
}
