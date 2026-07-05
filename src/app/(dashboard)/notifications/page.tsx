export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { NotificationsPageClient } from "./notifications-page-client";

export default async function NotificationsPage() {
  const user = await requireAuthCached();

  return <NotificationsPageClient userRole={user.role} />;
}
