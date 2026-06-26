import { FollowUpsListClient } from "@/components/follow-ups/follow-ups-list-client";
import { listFollowUpsForStaff } from "@/lib/follow-ups/list-queries";
import { getDb } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export async function StaffFollowUpsView({ user }: { user: User }) {
  const db = getDb();
  const items = await listFollowUpsForStaff(db, user.id);

  return <FollowUpsListClient items={items} role="staff" />;
}
