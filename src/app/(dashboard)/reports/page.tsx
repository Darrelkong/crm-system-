export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { ReportsPlaceholder } from "./reports-placeholder";

export default async function ReportsPage() {
  const user = await requireAuth();
  return <ReportsPlaceholder role={user.role} />;
}
