export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { AdminFollowUpsView } from "@/components/follow-ups/admin-follow-ups-view";
import { StaffFollowUpsView } from "@/components/follow-ups/staff-follow-ups-view";

export default async function FollowUpsPage() {
  const user = await requireAuthCached();

  if (user.role === "admin") {
    return <AdminFollowUpsView />;
  }

  return <StaffFollowUpsView user={user} />;
}
