export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { ApprovalsPageClient } from "./approvals-page-client";

export default async function ApprovalsPage() {
  const user = await requireAuthCached();

  return <ApprovalsPageClient isAdmin={user.role === "admin"} />;
}
