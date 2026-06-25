export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { ApprovalsPageClient } from "./approvals-page-client";

export default async function ApprovalsPage() {
  const user = await requireAuth();

  return <ApprovalsPageClient isAdmin={user.role === "admin"} />;
}
