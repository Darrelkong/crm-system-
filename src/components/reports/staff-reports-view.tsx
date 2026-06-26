import { StaffReportsClient } from "@/components/reports/staff-reports-client";
import { getStaffReportsStats } from "@/lib/reports/staff-reports";
import { getDb } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export async function StaffReportsView({ user }: { user: User }) {
  const db = getDb();
  const stats = await getStaffReportsStats(db, user);

  return <StaffReportsClient stats={stats} />;
}
