export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { NotificationsPageClient } from "./notifications-page-client";

export default async function NotificationsPage() {
  const user = await requireAuth();

  return <NotificationsPageClient userRole={user.role} />;
}
