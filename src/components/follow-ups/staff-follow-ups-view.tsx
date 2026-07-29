import { FollowUpsListClient } from "@/components/follow-ups/follow-ups-list-client";
import {
  FOLLOW_UPS_LIST_LIMIT,
  listFollowUpsForStaff,
} from "@/lib/follow-ups/list-queries";
import type { FollowUpListFilters } from "@/lib/follow-ups/list-filters";
import { getDb } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export async function StaffFollowUpsView({
  user,
  initialFilters,
}: {
  user: User;
  initialFilters: FollowUpListFilters;
}) {
  const db = getDb();
  const items = await listFollowUpsForStaff(db, user.id);

  return (
    <FollowUpsListClient
      items={items}
      role="staff"
      initialFilters={initialFilters}
      listLimit={FOLLOW_UPS_LIST_LIMIT}
    />
  );
}
