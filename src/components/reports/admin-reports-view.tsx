import { AdminReportsClient } from "@/components/reports/admin-reports-client";
import { getAdminReportsStats } from "@/lib/reports/admin-reports";
import { getDb } from "@/lib/db";

export async function AdminReportsView() {
  const db = getDb();
  const stats = await getAdminReportsStats(db);

  return <AdminReportsClient stats={stats} />;
}
